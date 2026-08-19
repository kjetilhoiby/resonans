import { db } from '$lib/db';
import { sensorEvents, canonicalWorkouts, workoutNotifications } from '$lib/db/schema';
import { and, eq, gte, lt, inArray, sql } from 'drizzle-orm';
import { aggregatePeriodsFrom } from '$lib/server/integrations/aggregation';
import { WorkoutProjectionService } from '$lib/server/services/workout-projection-service';
import { planRemoval, type RemovalCandidate } from '$lib/domain/health/workout-removal';

/**
 * Å rette eller fjerne en økt — og rydde alt som er avledet av den.
 *
 * ## Hvorfor kjeden bor her og ikke i endepunktene
 *
 * Fordi det er TO innganger til den: Ekko (brukeren trykker «rett» eller «slett» på et
 * øktkort) og vedlikeholdsendepunktet på dato. To implementasjoner av «rydd etter en økt»
 * ville drevet fra hverandre, og den ene ville glemt et lag — som er nøyaktig det
 * `POST /api/admin/cleanup-walking` gjorde: den sletter `sensor_events` og etterlater
 * `canonical_workouts` og `sensor_aggregates` med tallene intakt.
 *
 * Bakgrunnen er felttesten 17. august 2026: en elsykkeltur til jobb ble lagret som løping,
 * og «tidenes raskeste 5 km» havnet i Ekko, Resonans og Strava.
 *
 * ## Rett framfor slett
 *
 * **Retting er hovedveien.** Turen skjedde — det var merkelappen som var feil, og 8,3 km
 * elsykkel er ekte data. Sletting hører til ekte søppel: en fantomøkt på halvannet minutt.
 *
 * ## Hva som er avledet
 *
 * | Lag | Ved retting | Ved sletting |
 * |-----|-------------|--------------|
 * | `sensor_events` | `data.sportType` skrives om | slettes |
 * | `canonical_workouts` | reprojiseres (effort, bestEfforts, familie) | slettes |
 * | `workout_notifications` | står — turen finnes fortsatt | slettes |
 * | `sensor_aggregates` | reaggregeres | reaggregeres |
 * | rekorder, VO2max, EF, form | selvheler — regnes fra canonical ved lesing | selvheler |
 *
 * **Autohaking og målprogresjon rulles ikke tilbake** — vi haker aldri av automatisk
 * (`docs/changelog/2026-08-08-ivrig-autohaking.md`). Og Strava eier sin egen kopi.
 */

/** Vinduet vi slår opp i rundt en Oslo-dag. Døgnet krysser UTC-midnatt. */
function dayWindow(day: Date): { from: Date; to: Date } {
	const from = new Date(day);
	from.setUTCHours(0, 0, 0, 0);
	from.setUTCDate(from.getUTCDate() - 1);
	const to = new Date(day);
	to.setUTCHours(0, 0, 0, 0);
	to.setUTCDate(to.getUTCDate() + 2);
	return { from, to };
}

function toCandidate(row: { id: string; timestamp: Date; data: unknown }): RemovalCandidate {
	const data = (row.data ?? {}) as Record<string, unknown>;
	const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
	return {
		eventId: row.id,
		startTime: row.timestamp,
		sportType: typeof data.sportType === 'string' ? data.sportType : null,
		distanceMeters: num(data.distance),
		durationSeconds: num(data.duration),
		provider: typeof data.provider === 'string' ? data.provider : null
	};
}

/**
 * Radene Ekko-økta `sessionId` skrev.
 *
 * Bare Ekkos egne rader — `data.sessionId` settes av `/api/apps/upload`. Beskriver en
 * ANNEN kilde (klokka, Dropbox) samme tur, står den igjen: den er ikke vår å rette, og
 * dedupliseringen tar den fra da av. Det er et bevisst valg, og kalleren skal si det.
 */
export async function findEkkoWorkoutEvents(
	userId: string,
	sessionId: string
): Promise<RemovalCandidate[]> {
	const rows = await db
		.select({ id: sensorEvents.id, timestamp: sensorEvents.timestamp, data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'workout'),
				sql`${sensorEvents.data}->>'sessionId' = ${sessionId}`
			)
		);
	return rows.map(toCandidate);
}

export interface CleanupResult {
	sensorEvents: number;
	canonicalWorkouts: number;
	workoutNotifications: number;
	reaggregatedFrom: string | null;
	notCleaned: string[];
}

/**
 * Fjern øktene og rydd kjeden.
 *
 * Rekkefølgen er bevisst: projeksjonen først, så en feil halvveis etterlater kilderader vi
 * kan finne igjen framfor foreldreløse projeksjoner. Reaggregeringen sist, når det ikke er
 * mer å lese.
 */
export async function removeWorkouts(
	userId: string,
	candidates: RemovalCandidate[]
): Promise<CleanupResult> {
	const plan = planRemoval(candidates);
	if (plan.reaggregateFrom === null) {
		return {
			sensorEvents: 0,
			canonicalWorkouts: 0,
			workoutNotifications: 0,
			reaggregatedFrom: null,
			notCleaned: []
		};
	}
	const eventIds = candidates.map((c) => c.eventId);
	const { from, to } = dayWindow(plan.reaggregateFrom);

	const canonicalIds = await canonicalIdsFor(userId, eventIds, from, to);
	const canonicalDeleted = canonicalIds.length
		? await db
				.delete(canonicalWorkouts)
				.where(
					and(eq(canonicalWorkouts.userId, userId), inArray(canonicalWorkouts.id, canonicalIds))
				)
				.returning({ id: canonicalWorkouts.id })
		: [];

	// Varselbokføringen. Står den igjen, blokkerer den varsel om en EKTE økt som senere
	// havner i samme klynge.
	const notificationsDeleted = await db
		.delete(workoutNotifications)
		.where(
			and(
				eq(workoutNotifications.userId, userId),
				inArray(workoutNotifications.sensorEventId, eventIds)
			)
		)
		.returning({ id: workoutNotifications.id });

	const eventsDeleted = await db
		.delete(sensorEvents)
		.where(and(eq(sensorEvents.userId, userId), inArray(sensorEvents.id, eventIds)))
		.returning({ id: sensorEvents.id });

	await aggregatePeriodsFrom(userId, plan.reaggregateFrom);

	return {
		sensorEvents: eventsDeleted.length,
		canonicalWorkouts: canonicalDeleted.length,
		workoutNotifications: notificationsDeleted.length,
		reaggregatedFrom: plan.reaggregateFrom.toISOString(),
		notCleaned: plan.notCleaned
	};
}

export interface CorrectionResult {
	sensorEvents: number;
	sportType: string;
	reprojectedFrom: string | null;
	notCleaned: string[];
}

/**
 * Skriv om idretten og bygg det avledede på nytt.
 *
 * Canonical SLETTES ikke — den reprojiseres, så `effortScore` regnes med den nye
 * idrettens faktor (elsykkel 0,4 mot syklingens 1,0) og `sportFamily` følger med.
 * Rekordlista leser familien, så en feilmerket løpetur faller ut av den samme øyeblikk.
 */
export async function correctWorkoutSport(
	userId: string,
	candidates: RemovalCandidate[],
	sportType: string
): Promise<CorrectionResult> {
	if (candidates.length === 0) {
		return { sensorEvents: 0, sportType, reprojectedFrom: null, notCleaned: [] };
	}
	const earliest = candidates.reduce(
		(min, c) => (c.startTime.getTime() < min.getTime() ? c.startTime : min),
		candidates[0].startTime
	);
	const dayStart = new Date(earliest);
	dayStart.setUTCHours(0, 0, 0, 0);
	const eventIds = candidates.map((c) => c.eventId);

	// jsonb bygges i SQL, aldri som en JSON.stringify-parameter: `data || $1::jsonb` med en
	// streng blir KONKATENERING i Postgres, og raden blir en array. Den feilen kostet
	// søvnradene i august (`0048_repair_sleep_data_arrays.sql`).
	const updated = await db
		.update(sensorEvents)
		.set({ data: sql`${sensorEvents.data} || jsonb_build_object('sportType', ${sportType}::text)` })
		.where(
			and(
				eq(sensorEvents.userId, userId),
				inArray(sensorEvents.id, eventIds),
				sql`jsonb_typeof(${sensorEvents.data}) = 'object'`
			)
		)
		.returning({ id: sensorEvents.id });

	const { to } = dayWindow(dayStart);
	await WorkoutProjectionService.refreshForRange(userId, dayStart, to);
	await aggregatePeriodsFrom(userId, dayStart);

	return {
		sensorEvents: updated.length,
		sportType,
		reprojectedFrom: dayStart.toISOString(),
		notCleaned: [
			'Avhakede oppgaver og opptjent målprogresjon står — vi haker aldri av automatisk.',
			'Aktiviteten i Strava må rettes der; Resonans eier ikke den kopien.'
		]
	};
}

/**
 * Canonical-radene som hviler på disse kilderadene.
 *
 * Matchingen skjer i JS framfor i SQL: `evidence` er en jsonb-array, og en `EXISTS`-spørring
 * over den måtte bygget id-lista inn i teksten. Vinduet er én dag, så det er få rader.
 */
async function canonicalIdsFor(
	userId: string,
	eventIds: string[],
	from: Date,
	to: Date
): Promise<string[]> {
	const rows = await db
		.select({ id: canonicalWorkouts.id, evidence: canonicalWorkouts.evidence })
		.from(canonicalWorkouts)
		.where(
			and(
				eq(canonicalWorkouts.userId, userId),
				gte(canonicalWorkouts.startTime, from),
				lt(canonicalWorkouts.startTime, to)
			)
		);
	const wanted = new Set(eventIds);
	return rows.filter((r) => (r.evidence ?? []).some((ev) => wanted.has(ev.eventId))).map((r) => r.id);
}
