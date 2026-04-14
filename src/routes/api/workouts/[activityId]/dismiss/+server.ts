import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * POST /api/workouts/[activityId]/dismiss
 * Skjuler en treningsøkt ved å sette metadata.dismissed = true.
 * Økten slettes ikke fra databasen — den vises bare ikke i kanonisk lag.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;

	const result = await db
		.update(sensorEvents)
		.set({
			metadata: sql`jsonb_set(COALESCE(${sensorEvents.metadata}, '{}'::jsonb), '{dismissed}', 'true'::jsonb)`
		})
		.where(and(eq(sensorEvents.id, params.activityId), eq(sensorEvents.userId, userId)))
		.returning({ id: sensorEvents.id });

	if (result.length === 0) {
		return json({ error: 'Økt ikke funnet' }, { status: 404 });
	}

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
		.returning({ id: sensorEvents.id });

	if (result.length === 0) {
		return json({ error: 'Økt ikke funnet' }, { status: 404 });
	}

	return json({ success: true });
};
