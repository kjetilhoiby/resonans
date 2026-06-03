import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, or, sql } from 'drizzle-orm';
import { enqueueWorkoutProjectionRefresh, projectionWindowFromWorkoutTimestamp } from '$lib/server/workout-projection-refresh-queue';

function eventKey(sensorId: string | null, dataType: string | null, timestamp: Date): string {
	return `${sensorId ?? 'null'}::${dataType ?? 'null'}::${timestamp.toISOString()}`;
}

export type WriteSensorEventInput = {
	userId: string;
	sensorId: string;
	eventType: string;
	dataType: string;
	timestamp: Date;
	data: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	dedupeKey?: string;
	source: string;
};

export type WriteSensorEventResult = {
	event: typeof sensorEvents.$inferSelect | null;
	inserted: boolean;
	enqueuedProjectionRefresh: boolean;
};

const SPORT_ALIASES: Record<string, string> = {
	'cycling': 'bike',
	'e_bike': 'bike',
	'indoor_cycling': 'bike',
	'running': 'run',
	'indoor_running': 'run',
	'walking': 'walk',
	'indoor_walking': 'walk',
	'hiking': 'walk',
	'lift_weights': 'strength',
	'calisthenics': 'strength',
	'weight_training': 'strength',
};

function areSportsCompatible(a: string | undefined, b: string | undefined): boolean {
	if (!a || !b) return false;
	if (a === b) return true;
	const normA = SPORT_ALIASES[a] || a;
	const normB = SPORT_ALIASES[b] || b;
	return normA === normB;
}

/**
 * Merge workout data from a new source into an existing workout event.
 * Keeps per-source raw data in `sourceData`, picks best value per field.
 */
export function mergeWorkoutData(
	existing: Record<string, unknown>,
	incoming: Record<string, unknown>,
	incomingSource: string
): Record<string, unknown> {
	const sourceData: Record<string, Record<string, unknown>> = (existing.sourceData as any) ?? {};

	// If existing data has no sourceData yet, infer source and backfill
	if (Object.keys(sourceData).length === 0 && existing.sportType) {
		const existingMeta = (existing._mergeSource as string) || 'withings';
		const { sourceData: _sd, _mergeSource: _ms, ...existingClean } = existing as any;
		sourceData[existingMeta] = existingClean;
	}

	// Store incoming source data
	const { sourceData: _sd, _mergeSource: _ms, ...incomingClean } = incoming as any;
	sourceData[incomingSource] = incomingClean;

	// Priority: which source wins for each field category
	// GPS/distance: strava > withings (Strava has real GPS)
	// HR data: withings > strava (ScanWatch continuous optical HR)
	// Calories: strava > withings (Strava uses power/GPS for better estimate)
	const SOURCE_PRIORITY: Record<string, string[]> = {
		distance: ['email_gpx', 'strava', 'withings'],
		gpsTrack: ['email_gpx', 'strava'],
		trackPoints: ['email_gpx', 'strava'],
		elevation: ['email_gpx', 'strava', 'withings'],
		elevationMax: ['email_gpx', 'strava', 'withings'],
		elevationMin: ['email_gpx', 'strava', 'withings'],
		avgHeartRate: ['withings', 'email_gpx', 'strava'],
		maxHeartRate: ['withings', 'email_gpx', 'strava'],
		minHeartRate: ['withings', 'email_gpx', 'strava'],
		hrCurve: ['withings', 'email_gpx', 'strava'],
		hrZones: ['withings', 'strava'],
		calories: ['strava', 'email_gpx', 'withings'],
		avgSpeed: ['strava', 'email_gpx', 'withings'],
		maxSpeed: ['strava', 'email_gpx', 'withings'],
		avgPower: ['strava', 'email_gpx'],
		avgCadence: ['strava', 'email_gpx'],
		paceSecondsPerKm: ['email_gpx', 'strava'],
	};

	// Build merged top-level fields
	const allSources = Object.keys(sourceData);
	const merged: Record<string, unknown> = {
		sportType: existing.sportType || incoming.sportType,
		duration: existing.duration || incoming.duration,
	};

	// For each field, pick the best source according to priority
	const allFields = new Set<string>();
	for (const src of Object.values(sourceData)) {
		for (const key of Object.keys(src)) allFields.add(key);
	}

	for (const field of allFields) {
		if (field === 'sportType' || field === 'duration') continue;
		const priority = SOURCE_PRIORITY[field] || allSources;
		let bestVal: unknown = undefined;
		for (const src of priority) {
			const val = sourceData[src]?.[field];
			if (val != null) { bestVal = val; break; }
		}
		if (bestVal == null) {
			// Fallback: any source that has this field
			for (const src of allSources) {
				const val = sourceData[src]?.[field];
				if (val != null) { bestVal = val; break; }
			}
		}
		if (bestVal != null) merged[field] = bestVal;
	}

	merged.sourceData = sourceData;
	return merged;
}

const INDOOR_SPORT_TYPES = new Set([
	'yoga', 'lift_weights', 'calisthenics', 'weight_training',
	'indoor_cycling', 'pilates', 'stretching', 'indoor_running'
]);

/**
 * Determine if a workout has enough data to be worth notifying about.
 * - Indoor/non-GPS sports: just need duration
 * - Outdoor/distance sports: need GPS track or HR data
 */
export function workoutHasEnoughData(data: Record<string, unknown>): boolean {
	const sport = data.sportType as string;
	const duration = data.duration as number;
	if (!sport || !duration || duration < 60) return false;

	if (INDOOR_SPORT_TYPES.has(sport)) return true;

	const hasGps = !!(data.gpsTrack || data.trackPoints);
	const hasHr = !!(data.hrCurve || data.avgHeartRate);
	return hasGps || hasHr;
}

export type SensorEventWriteConflictMode =
	| 'error'
	| 'ignore'
	| 'upsert_sensor_datatype_timestamp';

export type SensorEventWriteOptions = {
	conflictMode?: SensorEventWriteConflictMode;
};

export class SensorEventService {
	/**
	 * Write workout events with multi-source merge support.
	 * For each incoming workout, looks for an existing workout from a DIFFERENT
	 * sensor within ±10 min with a compatible sport type. If found, merges into
	 * that row (no new row created). Otherwise upserts normally.
	 */
	/**
	 * Write workout events with multi-source merge support.
	 * For each incoming workout, looks for an existing workout from a DIFFERENT
	 * sensor within ±10 min with a compatible sport type. If found, merges into
	 * that row (no new row created). Otherwise upserts normally.
	 *
	 * Returns IDs of workouts that became notification-worthy after this write
	 * (transitioned from "not enough data" to "enough data", and not yet notified).
	 */
	static async writeWorkoutsWithMerge(
		inputs: WriteSensorEventInput[],
		sourceName: string
	): Promise<{ written: number; merged: number; readyToNotify: string[] }> {
		if (inputs.length === 0) return { written: 0, merged: 0, readyToNotify: [] };
		let merged = 0;
		let written = 0;
		const readyToNotify: string[] = [];

		for (const input of inputs) {
			const windowMs = 10 * 60 * 1000;
			const tMin = new Date(input.timestamp.getTime() - windowMs);
			const tMax = new Date(input.timestamp.getTime() + windowMs);

			const candidates = await db
				.select()
				.from(sensorEvents)
				.where(and(
					eq(sensorEvents.userId, input.userId),
					eq(sensorEvents.dataType, 'workout'),
					sql`${sensorEvents.timestamp} >= ${tMin}`,
					sql`${sensorEvents.timestamp} <= ${tMax}`,
					sql`${sensorEvents.sensorId} != ${input.sensorId}`
				))
				.limit(5);

			const incomingSport = (input.data as any).sportType;
			const match = candidates
				.sort((a, b) =>
					Math.abs(new Date(a.timestamp).getTime() - input.timestamp.getTime()) -
					Math.abs(new Date(b.timestamp).getTime() - input.timestamp.getTime())
				)
				.find(c => {
					const existingSport = (c.data as any)?.sportType;
					return areSportsCompatible(existingSport, incomingSport);
				});

			if (match) {
				const existingData = match.data as Record<string, unknown>;
				const existingMeta = match.metadata as Record<string, unknown>;
				const hadEnoughBefore = workoutHasEnoughData(existingData);
				const alreadyNotified = !!(existingMeta as any)?.workoutNotified;

				const mergedData = mergeWorkoutData(existingData, input.data, sourceName);
				const hasEnoughNow = workoutHasEnoughData(mergedData);

				const updatedMeta = {
					...existingMeta,
					sources: [...new Set([
						...((existingMeta as any)?.sources || [(existingMeta as any)?.source]),
						input.source
					])]
				};

				await db.update(sensorEvents)
					.set({ data: mergedData, metadata: updatedMeta })
					.where(eq(sensorEvents.id, match.id));
				merged++;

				if (hasEnoughNow && !hadEnoughBefore && !alreadyNotified) {
					readyToNotify.push(match.id);
				}
			} else {
				const taggedData = {
					...input.data,
					sourceData: { [sourceName]: { ...input.data } }
				};
				const result = await SensorEventService.write(
					{ ...input, data: taggedData },
					{ conflictMode: 'upsert_sensor_datatype_timestamp' }
				);
				written++;

				if (result.event && workoutHasEnoughData(taggedData) && !(input.metadata as any)?.workoutNotified) {
					readyToNotify.push(result.event.id);
				}
			}
		}

		if (merged > 0) {
			console.log(`[sensor-event-service] merged ${merged} workouts from ${sourceName} with existing data`);
		}
		return { written, merged, readyToNotify };
	}

	static async write(
		input: WriteSensorEventInput,
		options: SensorEventWriteOptions = {}
	): Promise<WriteSensorEventResult> {
		const conflictMode = options.conflictMode ?? 'error';
		const key = eventKey(input.sensorId, input.dataType, input.timestamp);
		let existedBefore = false;
		if (conflictMode === 'upsert_sensor_datatype_timestamp') {
			const existing = await db.query.sensorEvents.findFirst({
				columns: { id: true },
				where: and(
					eq(sensorEvents.sensorId, input.sensorId),
					eq(sensorEvents.dataType, input.dataType),
					eq(sensorEvents.timestamp, input.timestamp)
				)
			});
			existedBefore = Boolean(existing);
		}
		const values = {
			userId: input.userId,
			sensorId: input.sensorId,
			eventType: input.eventType,
			dataType: input.dataType,
			timestamp: input.timestamp,
			data: input.data,
			metadata: {
				...(input.metadata ?? {}),
				source: input.source,
				dedupeKey: input.dedupeKey ?? null
			}
		};

		const t0 = performance.now();
		let insertedRows: Array<typeof sensorEvents.$inferSelect> = [];
		if (conflictMode === 'ignore') {
			insertedRows = await db.insert(sensorEvents).values(values).onConflictDoNothing().returning();
		} else if (conflictMode === 'upsert_sensor_datatype_timestamp') {
			insertedRows = await db
				.insert(sensorEvents)
				.values(values)
				.onConflictDoUpdate({
					target: [sensorEvents.sensorId, sensorEvents.dataType, sensorEvents.timestamp],
					targetWhere: sql`data_type NOT IN ('bank_balance', 'bank_transaction')`,
					set: {
						eventType: values.eventType,
						data: values.data,
						metadata: values.metadata
					}
				})
				.returning();
		} else {
			insertedRows = await db.insert(sensorEvents).values(values).returning();
		}
		const event = insertedRows[0] ?? null;
		const inserted = Boolean(event);
		const insertedCount = inserted ? (existedBefore ? 0 : 1) : 0;
		const upsertedCount = inserted && existedBefore ? 1 : 0;
		const ignoredCount = conflictMode === 'ignore' && !inserted ? 1 : 0;

		const enqueuedProjectionRefresh =
			inserted && input.dataType === 'workout'
				? await enqueueWorkoutProjectionRefresh({
						userId: input.userId,
						...projectionWindowFromWorkoutTimestamp(input.timestamp),
						reason: 'on_write'
					}).then((r) => r.enqueued)
				: false;

		console.log(
			`[sensor-event-service] write source=${input.source} dataType=${input.dataType} mode=${conflictMode} key=${key} inserted=${insertedCount} upserted=${upsertedCount} ignored=${ignoredCount} enqueue=${enqueuedProjectionRefresh ? 1 : 0} durationMs=${(performance.now() - t0).toFixed(0)}`
		);

		return {
			event,
			inserted,
			enqueuedProjectionRefresh
		};
	}

	static async writeMany(
		inputs: WriteSensorEventInput[],
		options: SensorEventWriteOptions = {}
	): Promise<WriteSensorEventResult[]> {
		if (inputs.length === 0) return [];
		const conflictMode = options.conflictMode ?? 'error';
		const inputKeys = new Set(inputs.map((input) => eventKey(input.sensorId, input.dataType, input.timestamp)));
		const existingKeys = new Set<string>();

		if (conflictMode === 'upsert_sensor_datatype_timestamp') {
			const preExistingRows = await db
				.select({ sensorId: sensorEvents.sensorId, dataType: sensorEvents.dataType, timestamp: sensorEvents.timestamp })
				.from(sensorEvents)
				.where(
					or(
						...inputs.map((input) =>
							and(
								eq(sensorEvents.sensorId, input.sensorId),
								eq(sensorEvents.dataType, input.dataType),
								eq(sensorEvents.timestamp, input.timestamp)
							)
						)
					)
				);

			for (const row of preExistingRows) {
				existingKeys.add(eventKey(row.sensorId, row.dataType, row.timestamp));
			}
		}

		const toRow = (input: WriteSensorEventInput) => ({
			userId: input.userId,
			sensorId: input.sensorId,
			eventType: input.eventType,
			dataType: input.dataType,
			timestamp: input.timestamp,
			data: input.data,
			metadata: {
				...(input.metadata ?? {}),
				source: input.source,
				dedupeKey: input.dedupeKey ?? null
			}
		});
		// Postgres rejects multi-row ON CONFLICT DO UPDATE when two rows share the same
		// conflict target. The partial unique index is (sensor_id, data_type, timestamp)
		// WHERE data_type NOT IN bank-types, so in upsert mode collapse non-bank inputs
		// by that key (last write wins) and pass bank rows through untouched.
		let rows: ReturnType<typeof toRow>[];
		let dedupedDropped = 0;
		if (conflictMode === 'upsert_sensor_datatype_timestamp') {
			const dedupedByKey = new Map<string, ReturnType<typeof toRow>>();
			const passthrough: ReturnType<typeof toRow>[] = [];
			for (const input of inputs) {
				if (input.dataType === 'bank_balance' || input.dataType === 'bank_transaction') {
					passthrough.push(toRow(input));
				} else {
					dedupedByKey.set(eventKey(input.sensorId, input.dataType, input.timestamp), toRow(input));
				}
			}
			rows = [...dedupedByKey.values(), ...passthrough];
			dedupedDropped = inputs.length - rows.length;
		} else {
			rows = inputs.map(toRow);
		}

		const t0 = performance.now();
		let events: Array<typeof sensorEvents.$inferSelect> = [];
		if (conflictMode === 'ignore') {
			events = await db.insert(sensorEvents).values(rows).onConflictDoNothing().returning();
		} else if (conflictMode === 'upsert_sensor_datatype_timestamp') {
			events = await db
				.insert(sensorEvents)
				.values(rows)
				.onConflictDoUpdate({
					target: [sensorEvents.sensorId, sensorEvents.dataType, sensorEvents.timestamp],
					targetWhere: sql`data_type NOT IN ('bank_balance', 'bank_transaction')`,
					set: {
						eventType: sql`excluded.event_type`,
						data: sql`excluded.data`,
						metadata: sql`excluded.metadata`
					}
				})
				.returning();
		} else {
			events = await db.insert(sensorEvents).values(rows).returning();
		}

		const workoutEvents = inputs.filter((input) => input.dataType === 'workout');
		let enqueuedProjectionRefresh = false;
		if (workoutEvents.length > 0) {
			const workoutsByUser = new Map<string, Date>();
			for (const workout of workoutEvents) {
				const current = workoutsByUser.get(workout.userId);
				if (!current || workout.timestamp.getTime() < current.getTime()) {
					workoutsByUser.set(workout.userId, workout.timestamp);
				}
			}

			for (const [userId, minTs] of workoutsByUser.entries()) {
				const queued = await enqueueWorkoutProjectionRefresh({
					userId,
					...projectionWindowFromWorkoutTimestamp(minTs),
					reason: 'on_write'
				});
				enqueuedProjectionRefresh = enqueuedProjectionRefresh || queued.enqueued;
			}
		}

		const insertedOrUpsertedCount = events.length;
		const ignoredCount = Math.max(0, inputs.length - insertedOrUpsertedCount);
		let insertedCount = insertedOrUpsertedCount;
		let upsertedCount = 0;

		if (conflictMode === 'upsert_sensor_datatype_timestamp') {
			upsertedCount = events.filter((event) => existingKeys.has(eventKey(event.sensorId, event.dataType, event.timestamp))).length;
			insertedCount = Math.max(0, insertedOrUpsertedCount - upsertedCount);
		}

		console.log(
			`[sensor-event-service] writeMany size=${inputs.length} mode=${conflictMode} inserted=${insertedCount} upserted=${upsertedCount} ignored=${ignoredCount} dedupedDropped=${dedupedDropped} keyCount=${inputKeys.size} workouts=${workoutEvents.length} enqueue=${enqueuedProjectionRefresh ? 1 : 0} durationMs=${(performance.now() - t0).toFixed(0)}`
		);

		return events.map((event) => ({
			event,
			inserted: true,
			enqueuedProjectionRefresh: enqueuedProjectionRefresh && event.dataType === 'workout'
		}));
	}
}
