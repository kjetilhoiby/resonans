import { db } from '$lib/db';
import { canonicalWorkouts, sensorEvents } from '$lib/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { WorkoutProjectionService } from '$lib/server/services/workout-projection-service';
import { projectionWindowFromWorkoutTimestamp } from '$lib/server/workout-projection-refresh-queue';
import { aggregatePeriodsFrom } from '$lib/server/integrations/aggregation';
import { aggregationStartDate } from '$lib/domain/health/workout-followup';
import { metadataKeyForScope, type DismissScope } from '$lib/domain/health/workout-dismiss';

/**
 * Skjuling og gjenåpning av en treningsøkt — ÉN implementasjon, delt av
 * web-flaten (`/api/workouts/[activityId]/dismiss`) og Ekko
 * (`/api/apps/workouts/[id]/dismiss`).
 *
 * Ligger her og ikke i en av rutene fordi de to inngangene ellers ville hatt
 * hver sin kopi av etterarbeidet, og det er nøyaktig slik den ene rekker å
 * drive fra den andre: skjulestien manglet lenge re-aggregeringen som
 * skrivestien alltid har hatt, og en skjult økt ble stående i formkurven til
 * nattjobben.
 *
 * De rene delene (scope-tolkning) bor i `$lib/domain/health/workout-dismiss`.
 */

export { parseDismissScope, metadataKeyForScope } from '$lib/domain/health/workout-dismiss';
export type { DismissScope } from '$lib/domain/health/workout-dismiss';

export type DismissWorkoutResult =
	| { ok: true; eventId: string; timestamp: Date; scope: DismissScope; hidden: boolean }
	| { ok: false; reason: 'not_found' };

/**
 * Oversetter id-en kalleren holder til en `sensor_events`-rad.
 *
 * Ekko kjenner to former, samme konvensjon som
 * `/api/apps/workouts/[id]/analysis`: en canonical-workout-id eller en
 * sensor_event-id. Rekkefølgen er event først — den er den STABILE av de to.
 * `WorkoutProjectionService.refreshForRange` sletter og bygger
 * `canonical_workouts` på nytt, så canonical-id-en er fersk hver gang
 * projeksjonen kjører, mens `sensor_events.id` står. En klient som har lagret
 * en canonical-id kan derfor komme tilbake med en som ikke finnes lenger.
 *
 * Fra en canonical-rad velges klyngens ELDSTE evidence-event. Det er samme rad
 * `activityId` peker på i aktivitetslaget, så de to inngangene merker den
 * samme raden — og siden filteret ekskluderer klynger der *en hvilken som helst*
 * hendelse er skjult, holder det å merke én.
 */
async function resolveWorkoutEvent(
	userId: string,
	id: string
): Promise<{ id: string; timestamp: Date } | null> {
	const event = await db.query.sensorEvents.findFirst({
		columns: { id: true, timestamp: true },
		where: and(
			eq(sensorEvents.id, id),
			eq(sensorEvents.userId, userId),
			eq(sensorEvents.dataType, 'workout')
		)
	});
	if (event) return event;

	const canonical = await db.query.canonicalWorkouts.findFirst({
		columns: { evidence: true },
		where: and(eq(canonicalWorkouts.id, id), eq(canonicalWorkouts.userId, userId))
	});
	if (!canonical) return null;

	const eventIds = ((canonical.evidence ?? []) as Array<{ eventId?: unknown }>)
		.map((entry) => entry?.eventId)
		.filter((value): value is string => typeof value === 'string');
	if (eventIds.length === 0) return null;

	const rows = await db.query.sensorEvents.findMany({
		columns: { id: true, timestamp: true },
		where: and(
			eq(sensorEvents.userId, userId),
			eq(sensorEvents.dataType, 'workout'),
			inArray(sensorEvents.id, eventIds)
		),
		orderBy: (events, { asc }) => [asc(events.timestamp)]
	});
	return rows[0] ?? null;
}

/**
 * Re-materialiser projeksjonene rundt en skjult/gjenåpnet økt.
 *
 * To steg, og begge trengs. `refreshForRange` skriver `canonical_workouts` og
 * `workout_daily_aggregates` — det aktivitetslista, løpemål og uke-/måneds-
 * progresjon leser. Men form- og belastningskortene (CTL/ATL/TSB) leser
 * `sensor_aggregates`-DAGSRADEN, og den skrives bare av `aggregateDailyEffort`.
 * Uten det andre steget forsvant en skjult økt fra lista med det samme og ble
 * stående i formkurven til nattjobben kl. 03 UTC — en søppeløkt på fem timer
 * flytter TSB nok til at kortet ba om hvile brukeren ikke trengte.
 *
 * Begge er best-effort: feiler de, heles det ved neste cron-kjøring. Vi lar
 * derfor ikke en feil her velte selve skjulingen, som alt er lagret.
 */
export async function refreshAfterDismissChange(userId: string, timestamp: Date): Promise<void> {
	try {
		const { fromDate, toDate } = projectionWindowFromWorkoutTimestamp(timestamp);
		await WorkoutProjectionService.refreshForRange(userId, fromDate, toDate);
	} catch (error) {
		console.error('[dismiss] kunne ikke re-materialisere projeksjon:', error);
	}

	try {
		await aggregatePeriodsFrom(userId, aggregationStartDate([timestamp], new Date()));
	} catch (error) {
		console.error('[dismiss] kunne ikke re-aggregere dagsraden:', error);
	}
}

/**
 * Skjuler eller gjenåpner en økt.
 *
 * Raden SLETTES aldri, og det er ikke en forsiktighetsregel — det er den eneste
 * varige semantikken for en synket kilde. Withings-økter hentes på nytt hvert
 * femte minutt med sju dagers overlapp, så en slettet rad ville vært tilbake før
 * brukeren rakk å se etter. Et flagg på raden overlever synken (se
 * `USER_OWNED_METADATA_KEYS`); en sletting gjør det ikke.
 */
export async function setWorkoutDismissed(
	userId: string,
	id: string,
	options: { hidden: boolean; scope?: DismissScope }
): Promise<DismissWorkoutResult> {
	const scope = options.scope ?? 'activity';
	const key = metadataKeyForScope(scope);

	const target = await resolveWorkoutEvent(userId, id);
	if (!target) return { ok: false, reason: 'not_found' };

	const metadata = options.hidden
		? sql`jsonb_set(COALESCE(${sensorEvents.metadata}, '{}'::jsonb), ${`{${key}}`}::text[], 'true'::jsonb)`
		: sql`COALESCE(${sensorEvents.metadata}, '{}'::jsonb) - ${key}`;

	const updated = await db
		.update(sensorEvents)
		.set({ metadata })
		.where(and(eq(sensorEvents.id, target.id), eq(sensorEvents.userId, userId)))
		.returning({ id: sensorEvents.id, timestamp: sensorEvents.timestamp });

	if (updated.length === 0) return { ok: false, reason: 'not_found' };

	await refreshAfterDismissChange(userId, updated[0].timestamp);

	return {
		ok: true,
		eventId: updated[0].id,
		timestamp: updated[0].timestamp,
		scope,
		hidden: options.hidden
	};
}
