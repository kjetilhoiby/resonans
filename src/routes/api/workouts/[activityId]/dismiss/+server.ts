import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { WorkoutProjectionService } from '$lib/server/services/workout-projection-service';
import { projectionWindowFromWorkoutTimestamp } from '$lib/server/workout-projection-refresh-queue';
import { aggregatePeriodsFrom } from '$lib/server/integrations/aggregation';
import { aggregationStartDate } from '$lib/domain/health/workout-followup';
import type { RequestHandler } from './$types';

/**
 * Re-materialiser kanoniske projeksjoner (canonical_workouts +
 * workout_daily_aggregates) for vinduet rundt en skjult/gjenåpnet økt, slik at
 * endringen umiddelbart slår gjennom i aggregerte tall — løpemål, uke-/måneds-
 * progresjon og weekly effort. Aktivitetsfeeden filtrerer dismissed live, men
 * disse projeksjonene må bygges på nytt. Best-effort: feiler dette, heles det
 * uansett ved neste projeksjons-refresh (cron/sweeper).
 *
 * `aggregatePeriodsFrom` etterpå er ikke valgfritt, og det manglet fram til
 * august 2026: `refreshForRange` skriver `canonical_workouts` og
 * `workout_daily_aggregates`, men form- og belastningskortene (CTL/ATL/TSB)
 * leser `sensor_aggregates`-DAGSRADEN, som bare `aggregateDailyEffort` skriver.
 * Uten dette forsvant en skjult økt fra lista med det samme, men ble stående i
 * formkurven til nattjobben kl. 03 UTC — og en søppeløkt på fem timer flytter
 * TSB nok til at kortet ba om hvile brukeren ikke trengte.
 *
 * Skrivestien gjør nøyaktig det samme i `runAfterWorkoutWrite`; dette er samme
 * krav i motsatt retning.
 */
async function refreshProjectionForEvent(userId: string, timestamp: Date): Promise<void> {
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
 * `?scope=source` → avviser én enkelt kilde-registrering (`metadata.sourceRejected`), som
 * ekskluderes fra sin aktivitet på event-nivå (aktiviteten består på gjenværende kilder).
 * Uten scope → skjuler HELE økta (`metadata.dismissed`, klynge-nivå). Begge er reversible.
 */
function metadataKeyForScope(scope: string | null): 'dismissed' | 'sourceRejected' {
	return scope === 'source' ? 'sourceRejected' : 'dismissed';
}

/**
 * POST /api/workouts/[activityId]/dismiss
 * Skjuler en treningsøkt ved å sette metadata.dismissed = true.
 * Økten slettes ikke fra databasen — den vises bare ikke i kanonisk lag og
 * telles ikke med i aggregerte tall.
 */
export const POST: RequestHandler = async ({ locals, params, url }) => {
	const userId = locals.userId;
	const key = metadataKeyForScope(url.searchParams.get('scope'));

	const result = await db
		.update(sensorEvents)
		.set({
			metadata: sql`jsonb_set(COALESCE(${sensorEvents.metadata}, '{}'::jsonb), ${`{${key}}`}::text[], 'true'::jsonb)`
		})
		.where(and(eq(sensorEvents.id, params.activityId), eq(sensorEvents.userId, userId)))
		.returning({ id: sensorEvents.id, timestamp: sensorEvents.timestamp });

	if (result.length === 0) {
		return json({ error: 'Økt ikke funnet' }, { status: 404 });
	}

	await refreshProjectionForEvent(userId, result[0].timestamp);

	return json({ success: true });
};

/**
 * DELETE /api/workouts/[activityId]/dismiss
 * Angrer skjuling av en treningsøkt.
 */
export const DELETE: RequestHandler = async ({ locals, params, url }) => {
	const userId = locals.userId;
	const key = metadataKeyForScope(url.searchParams.get('scope'));

	const result = await db
		.update(sensorEvents)
		.set({
			metadata: sql`${sensorEvents.metadata} - ${key}`
		})
		.where(and(eq(sensorEvents.id, params.activityId), eq(sensorEvents.userId, userId)))
		.returning({ id: sensorEvents.id, timestamp: sensorEvents.timestamp });

	if (result.length === 0) {
		return json({ error: 'Økt ikke funnet' }, { status: 404 });
	}

	await refreshProjectionForEvent(userId, result[0].timestamp);

	return json({ success: true });
};
