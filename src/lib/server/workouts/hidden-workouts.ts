import { db } from '$lib/db';
import { sensorEvents, sensors, workoutSuppressions } from '$lib/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { clusterSportFamily, normalizeDistanceMeters } from '$lib/server/activity-layer';
import { isWorkoutSuppressed } from '$lib/domain/health/workout-suppression';
import { refreshAfterDismissChange, setWorkoutDismissed } from '$lib/server/workouts/dismiss-workout';

/**
 * «Hva har jeg skjult?» — for gjenoppretting.
 *
 * Lista MÅ dekke BEGGE sperrene, og det er hele grunnen til at modulen finnes.
 * Skjuling setter i dag to ting: `metadata.dismissed` på raden (rad-nivå) og en
 * rad i `workout_suppressions` (økt-nivå). Leser man bare svartelista, er økter
 * som ble skjult FØR den fantes usynlige — og de kan da ikke gjenopprettes i det
 * hele tatt, siden en skjult økt ikke finnes i noen liste å klikke på.
 *
 * Det er ikke et hypotetisk tilfelle: alt som er skjult i prod fram til
 * svartelista deployes har bare flagget.
 */

export type HiddenWorkout = {
	/** Handtaket for gjenoppretting. `sensor_events.id` når raden finnes, ellers svartelistingens id. */
	id: string;
	/** Hva som holder økta skjult. Styrer hvordan gjenoppretting utføres. */
	holds: Array<'flag' | 'suppression'>;
	startTime: string;
	sportType: string | null;
	sportFamily: string;
	distanceMeters: number | null;
	durationSeconds: number | null;
	/** Kildene som beskriver økta. Tom når bare svartelistingen står igjen. */
	providers: string[];
	/** `source` avviste én kilde-registrering, ikke hele økta. */
	scope: 'activity' | 'source';
	hiddenAt: string | null;
};

type DismissedEventRow = {
	id: string;
	sensorId: string;
	timestamp: Date;
	data: Record<string, unknown> | null;
	metadata: Record<string, unknown> | null;
};

/**
 * Rader brukeren har skjult eller kilde-avvist.
 *
 * Rå lesing er riktig her, og fila står med begrunnelse i `knownRawReaders`:
 * poenget ER de skjulte radene per kilde, og de er per definisjon filtrert bort
 * av det dedupliserte laget. Ingen delt leser kan svare på dette spørsmålet.
 */
async function listDismissedEvents(userId: string): Promise<DismissedEventRow[]> {
	const rows = await db
		.select({
			id: sensorEvents.id,
			sensorId: sensorEvents.sensorId,
			timestamp: sensorEvents.timestamp,
			data: sql<Record<string, unknown>>`jsonb_build_object(
				'sportType', ${sensorEvents.data}->'sportType',
				'distance', ${sensorEvents.data}->'distance',
				'duration', ${sensorEvents.data}->'duration'
			)`,
			metadata: sensorEvents.metadata
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'workout'),
				sql`(${sensorEvents.metadata}->>'dismissed' = 'true' OR ${sensorEvents.metadata}->>'sourceRejected' = 'true')`
			)
		)
		.orderBy(sql`${sensorEvents.timestamp} DESC`);

	return rows as DismissedEventRow[];
}

/**
 * Alt brukeren har skjult, nyeste først.
 *
 * En økt som holdes av begge sperrene vises som ÉN rad med `holds: ['flag',
 * 'suppression']`. To rader for samme økt ville sett ut som to skjulte økter, og
 * brukeren ville trykket «Gjenopprett» to ganger uten å forstå hvorfor.
 */
export async function listHiddenWorkouts(userId: string): Promise<HiddenWorkout[]> {
	const [events, suppressions] = await Promise.all([
		listDismissedEvents(userId),
		db
			.select({
				id: workoutSuppressions.id,
				startTime: workoutSuppressions.startTime,
				sportFamily: workoutSuppressions.sportFamily,
				createdAt: workoutSuppressions.createdAt
			})
			.from(workoutSuppressions)
			.where(eq(workoutSuppressions.userId, userId))
	]);

	const sensorIds = [...new Set(events.map((event) => event.sensorId))];
	const sensorRows = sensorIds.length
		? await db.query.sensors.findMany({
				where: inArray(sensors.id, sensorIds),
				columns: { id: true, provider: true }
			})
		: [];
	const providerById = new Map(sensorRows.map((row) => [row.id, row.provider ?? 'ukjent']));

	// Rader først: de bærer detaljene (distanse, varighet, kilde) en svartelisting
	// ikke har. Flere kilder for samme økt slås sammen på tid + familie, samme
	// nivå som klyngingen — ellers ville en tur fra klokka og fra Ekko vist som to.
	const byKey = new Map<string, HiddenWorkout>();

	for (const event of events) {
		const sportTypeRaw = event.data?.sportType;
		const sportType = typeof sportTypeRaw === 'string' ? sportTypeRaw.trim().toLowerCase() : null;
		const sportFamily = clusterSportFamily(sportType ?? 'workout');
		const scope = event.metadata?.sourceRejected === true || event.metadata?.sourceRejected === 'true'
			? 'source'
			: 'activity';
		const key = `${event.timestamp.toISOString()}::${sportFamily}::${scope}`;

		const existing = byKey.get(key);
		const provider = providerById.get(event.sensorId) ?? 'ukjent';
		if (existing) {
			if (!existing.providers.includes(provider)) existing.providers.push(provider);
			continue;
		}

		byKey.set(key, {
			id: event.id,
			holds: ['flag'],
			startTime: event.timestamp.toISOString(),
			sportType,
			sportFamily,
			distanceMeters: normalizeDistanceMeters(event.data?.distance),
			durationSeconds:
				typeof event.data?.duration === 'number' && event.data.duration > 0 ? event.data.duration : null,
			providers: [provider],
			scope,
			hiddenAt: null
		});
	}

	// Svartelistinger: knytt til en rad når toleransevinduet treffer, ellers stå
	// alene. Sistnevnte er en ekte tilstand — kilden kan ha sluttet å sende økta.
	for (const suppression of suppressions) {
		const match = [...byKey.values()].find(
			(hidden) =>
				hidden.scope === 'activity' &&
				isWorkoutSuppressed(
					{ startTime: new Date(hidden.startTime), sportFamily: hidden.sportFamily },
					[{ startTime: suppression.startTime, sportFamily: suppression.sportFamily }]
				)
		);

		if (match) {
			if (!match.holds.includes('suppression')) match.holds.push('suppression');
			match.hiddenAt = suppression.createdAt.toISOString();
			continue;
		}

		byKey.set(`suppression::${suppression.id}`, {
			id: suppression.id,
			holds: ['suppression'],
			startTime: suppression.startTime.toISOString(),
			sportType: null,
			sportFamily: suppression.sportFamily,
			distanceMeters: null,
			durationSeconds: null,
			providers: [],
			scope: 'activity',
			hiddenAt: suppression.createdAt.toISOString()
		});
	}

	return [...byKey.values()].sort(
		(a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
	);
}

export type RestoreResult = { ok: true } | { ok: false; reason: 'not_found' };

/**
 * Gjenopprett en skjult økt — fjerner BEGGE sperrene.
 *
 * Er `id` en `sensor_events.id`, går vi gjennom `setWorkoutDismissed`, som
 * rydder flagget, svartelistingen, projeksjonen og dagsraden i én operasjon.
 * Er den en ren svartelisting (ingen rad igjen), slettes bare den — det finnes
 * ingen rad å ta flagget av.
 */
export async function restoreHiddenWorkout(
	userId: string,
	id: string,
	scope: 'activity' | 'source' = 'activity'
): Promise<RestoreResult> {
	const result = await setWorkoutDismissed(userId, id, { hidden: false, scope });
	if (result.ok) return { ok: true };

	const deleted = await db
		.delete(workoutSuppressions)
		.where(and(eq(workoutSuppressions.id, id), eq(workoutSuppressions.userId, userId)))
		.returning({ startTime: workoutSuppressions.startTime });

	if (deleted.length === 0) return { ok: false, reason: 'not_found' };

	// Også her: projeksjon OG dagsrad. Skulle en rad dukke opp igjen fra kilden
	// etterpå, hører den i formkurven med det samme — ikke ved nattjobben.
	await refreshAfterDismissChange(userId, deleted[0].startTime);
	return { ok: true };
}
