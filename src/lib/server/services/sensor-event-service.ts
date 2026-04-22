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

export type SensorEventWriteConflictMode =
	| 'error'
	| 'ignore'
	| 'upsert_sensor_datatype_timestamp';

export type SensorEventWriteOptions = {
	conflictMode?: SensorEventWriteConflictMode;
};

export class SensorEventService {
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

		const rows = inputs.map((input) => ({
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
		}));

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
			`[sensor-event-service] writeMany size=${inputs.length} mode=${conflictMode} inserted=${insertedCount} upserted=${upsertedCount} ignored=${ignoredCount} keyCount=${inputKeys.size} workouts=${workoutEvents.length} enqueue=${enqueuedProjectionRefresh ? 1 : 0} durationMs=${(performance.now() - t0).toFixed(0)}`
		);

		return events.map((event) => ({
			event,
			inserted: true,
			enqueuedProjectionRefresh: enqueuedProjectionRefresh && event.dataType === 'workout'
		}));
	}
}
