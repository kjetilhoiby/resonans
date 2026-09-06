import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, or, sql } from 'drizzle-orm';
import { enqueueWorkoutProjectionRefresh, projectionWindowFromWorkoutTimestamp } from '$lib/server/workout-projection-refresh-queue';
import { runInBackground } from '$lib/server/run-in-background';
import { USER_OWNED_METADATA_KEYS } from '$lib/domain/sensor-event-metadata';

function eventKey(sensorId: string | null, dataType: string | null, timestamp: Date): string {
	return `${sensorId ?? 'null'}::${dataType ?? 'null'}::${timestamp.toISOString()}`;
}

/**
 * `metadata` for ON CONFLICT DO UPDATE: synkens ferske metadata, med brukerens
 * egne nøkler løftet tilbake fra raden som alt lå der.
 *
 * Uten dette overskrev hver upsert brukerens valg. Symptomet var en skjult økt
 * som kom tilbake av seg selv: Withings henter sju dagers overlapp hvert femte
 * minutt, så «Skjul» overlevde ikke natta. Se `$lib/domain/sensor-event-metadata`.
 *
 * `jsonb_strip_nulls` fjerner nøklene den gamle raden ikke hadde —
 * `jsonb_build_object('dismissed', NULL)` gir `{"dismissed": null}`, og en
 * eksplisitt null ville sett ut som en verdi for lesere som gjør `? 'dismissed'`.
 *
 * Nøkkelnavnene bindes som parametere, ikke interpoleres — og `::text` på begge
 * er påkrevd, ikke pynt: `->` er overlastet for `jsonb -> text` og
 * `jsonb -> integer`, så en utypet parameter kan gi «operator is not unique» fra
 * Postgres. Det er en feil enhetstestene ikke ville fanget, siden vi ikke
 * mocker databasen.
 */
const mergedMetadataOnConflict = sql`excluded.metadata || jsonb_strip_nulls(jsonb_build_object(${sql.join(
	USER_OWNED_METADATA_KEYS.map((key) => sql`${key}::text, ${sensorEvents.metadata}->${key}::text`),
	sql`, `
)}))`;

/**
 * Kjør projeksjonsjobben med en gang i stedet for å vente på cron.
 *
 * Uten dette oppdateres `canonical_workouts` først når /api/cron/background-jobs
 * fyrer — opptil ~5 minutter etter at et løp er skrevet. Alt som leser den
 * projeksjonen (streaks, målprogresjon, effort) hang tilsvarende etter.
 *
 * `waitUntil` holder funksjonen i live til jobben er ferdig, så responsen til
 * Ekko blir ikke tregere. Klarer ikke jobben å claimes (cron kom først), gir
 * processBackgroundJobById `not_claimable` og vi lar den ligge — den kjøres da
 * av den andre kjøringen.
 *
 * background-jobs importeres dynamisk: den modulen drar inn alle jobb-handlerne,
 * og sensor-skriving er en varm sti som ikke skal betale for det ved kaldstart.
 */
function runWorkoutProjectionInline(jobId: string | null, label: string): void {
	if (!jobId) return;
	runInBackground(
		import('$lib/server/background-jobs').then(({ processBackgroundJobById }) =>
			processBackgroundJobById(jobId, `workout-projection-inline-${label}`)
		)
	);
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
	/**
	 * Fantes raden fra før? Bare meningsfull i `upsert_sensor_datatype_timestamp`.
	 *
	 * Skiller «ny hendelse» fra «samme hendelse skrevet om igjen». Den
	 * inkrementelle Withings-synken henter 7 dagers overlapp hvert 5. minutt for
	 * å fange retroaktive revisjoner, så uten dette flagget ville
	 * `runAfterWorkoutWrite` regnet om aggregatene for en uke, hver eneste
	 * kjøring, uten at noe var endret.
	 */
	wasExisting: boolean;
	enqueuedProjectionRefresh: boolean;
};

export type SensorEventWriteConflictMode =
	| 'error'
	| 'ignore'
	| 'upsert_sensor_datatype_timestamp';

/**
 * Skal projeksjonen kjøres MED EN GANG, eller er det nok at den ligger i kø?
 *
 * `inline` er standarden og riktig for én fersk økt: brukeren har nettopp
 * avsluttet en tur og skal se den i streaks og formkurve uten å vente på cron.
 *
 * `queued` er for en IMPORT, og skillet er ikke smaksak. `write` fyrer
 * projeksjonen per RAD, og `refreshForRange` går over `timestamp − 2t → nå` —
 * for en økt fra 2012 er det fjorten år med canonical-rader, ~18 sekunder per
 * kjøring. Debouncen i `enqueueWorkoutProjectionRefresh` skulle slått dem
 * sammen, men den slår bare sammen jobber som fortsatt står `queued`: den
 * inline-kjøringen tar jobben ut av `queued` med det samme, så rad nummer to
 * lager en ny jobb i stedet for å slå seg sammen med den første. Resultatet er
 * én full-historikk-reprojeksjon per importert økt, kjørende rygg mot rygg,
 * som spiser tilkoblingspoolen og gjør hver skriving treg — som igjen får det
 * til å se ut som at parsingen er treg.
 *
 * Med `queued` faller bare inline-kjøringen bort. Jobben legges fortsatt i kø,
 * så ingenting går tapt om importen brytes midtveis, og NÅ virker debouncen
 * etter hensikten: alle radene som skrives mens den forrige jobben kjører,
 * slås sammen til én. Importen 5. september 2026 skrev fire jobber på 43
 * sekunder; med denne rekkefølgen ville de vært én.
 */
export type SensorEventProjectionMode = 'inline' | 'queued';

export type SensorEventWriteOptions = {
	conflictMode?: SensorEventWriteConflictMode;
	projectionMode?: SensorEventProjectionMode;
};

export class SensorEventService {
	static async write(
		input: WriteSensorEventInput,
		options: SensorEventWriteOptions = {}
	): Promise<WriteSensorEventResult> {
		const conflictMode = options.conflictMode ?? 'error';
		const projectionMode = options.projectionMode ?? 'inline';
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
					// Samme uttrykk som i writeMany: `excluded.*` er nøyaktig radene vi
					// nettopp forsøkte å sette inn, så de to stiene kan ikke drive fra
					// hverandre slik de gjorde da denne satte JS-verdiene direkte.
					set: {
						eventType: sql`excluded.event_type`,
						data: sql`excluded.data`,
						metadata: mergedMetadataOnConflict
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

		let enqueuedProjectionRefresh = false;
		if (inserted && input.dataType === 'workout') {
			const queued = await enqueueWorkoutProjectionRefresh({
				userId: input.userId,
				...projectionWindowFromWorkoutTimestamp(input.timestamp),
				reason: 'on_write'
			});
			enqueuedProjectionRefresh = queued.enqueued;
			if (projectionMode === 'inline') runWorkoutProjectionInline(queued.jobId, 'write');
		}

		console.log(
			`[sensor-event-service] write source=${input.source} dataType=${input.dataType} mode=${conflictMode} projection=${projectionMode} key=${key} inserted=${insertedCount} upserted=${upsertedCount} ignored=${ignoredCount} enqueue=${enqueuedProjectionRefresh ? 1 : 0} durationMs=${(performance.now() - t0).toFixed(0)}`
		);

		return {
			event,
			inserted,
			wasExisting: existedBefore,
			enqueuedProjectionRefresh
		};
	}

	static async writeMany(
		inputs: WriteSensorEventInput[],
		options: SensorEventWriteOptions = {}
	): Promise<WriteSensorEventResult[]> {
		if (inputs.length === 0) return [];
		const conflictMode = options.conflictMode ?? 'error';
		const projectionMode = options.projectionMode ?? 'inline';
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
						metadata: mergedMetadataOnConflict
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
				if (projectionMode === 'inline') runWorkoutProjectionInline(queued.jobId, 'write_many');
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
			`[sensor-event-service] writeMany size=${inputs.length} mode=${conflictMode} projection=${projectionMode} inserted=${insertedCount} upserted=${upsertedCount} ignored=${ignoredCount} dedupedDropped=${dedupedDropped} keyCount=${inputKeys.size} workouts=${workoutEvents.length} enqueue=${enqueuedProjectionRefresh ? 1 : 0} durationMs=${(performance.now() - t0).toFixed(0)}`
		);

		return events.map((event) => ({
			event,
			inserted: true,
			wasExisting: existingKeys.has(eventKey(event.sensorId, event.dataType, event.timestamp)),
			enqueuedProjectionRefresh: enqueuedProjectionRefresh && event.dataType === 'workout'
		}));
	}
}
