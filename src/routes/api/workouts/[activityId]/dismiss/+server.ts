import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { WorkoutProjectionService } from '$lib/server/services/workout-projection-service';
import { projectionWindowFromWorkoutTimestamp } from '$lib/server/workout-projection-refresh-queue';
import type { RequestHandler } from './$types';

/**
 * Re-materialiser kanoniske projeksjoner (canonical_workouts +
 * workout_daily_aggregates) for vinduet rundt en skjult/gjenåpnet økt, slik at
 * endringen umiddelbart slår gjennom i aggregerte tall — løpemål, uke-/måneds-
 * progresjon og weekly effort. Aktivitetsfeeden filtrerer dismissed live, men
 * disse projeksjonene må bygges på nytt. Best-effort: feiler dette, heles det
 * uansett ved neste projeksjons-refresh (cron/sweeper).
 */
async function refreshProjectionForEvent(userId: string, timestamp: Date): Promise<void> {
	try {
		const { fromDate, toDate } = projectionWindowFromWorkoutTimestamp(timestamp);
		await WorkoutProjectionService.refreshForRange(userId, fromDate, toDate);
	} catch (error) {
		console.error('[dismiss] kunne ikke re-materialisere projeksjon:', error);
	}
}

/**
 * POST /api/workouts/[activityId]/dismiss
 * Skjuler en treningsøkt ved å sette metadata.dismissed = true.
 * Økten slettes ikke fra databasen — den vises bare ikke i kanonisk lag og
 * telles ikke med i aggregerte tall.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;

	const result = await db
		.update(sensorEvents)
		.set({
			metadata: sql`jsonb_set(COALESCE(${sensorEvents.metadata}, '{}'::jsonb), '{dismissed}', 'true'::jsonb)`
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
export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;

	const result = await db
		.update(sensorEvents)
		.set({
			metadata: sql`${sensorEvents.metadata} - 'dismissed'`
		})
		.where(and(eq(sensorEvents.id, params.activityId), eq(sensorEvents.userId, userId)))
		.returning({ id: sensorEvents.id, timestamp: sensorEvents.timestamp });

	if (result.length === 0) {
		return json({ error: 'Økt ikke funnet' }, { status: 404 });
	}

	await refreshProjectionForEvent(userId, result[0].timestamp);

	return json({ success: true });
};
