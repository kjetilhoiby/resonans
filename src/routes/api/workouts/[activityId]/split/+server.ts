import { json } from '@sveltejs/kit';
import { setWorkoutSplit } from '$lib/server/workouts/split-workout';
import type { RequestHandler } from './$types';

/**
 * POST /api/workouts/[activityId]/split
 * Skiller kilden `activityId` (en `sensor_events`-id) ut til en egen økt. Andre
 * versjoner av samme opptak følger med. Se `$lib/server/workouts/split-workout`.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
	const result = await setWorkoutSplit(locals.userId, params.activityId, { split: true });
	if (!result.ok) return json({ error: 'Kilde ikke funnet' }, { status: 404 });
	return json({ success: true, eventIds: result.eventIds });
};

/**
 * DELETE /api/workouts/[activityId]/split
 * Slår en utskilt kilde (og resten av gruppa dens) sammen med klynga igjen.
 */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	const result = await setWorkoutSplit(locals.userId, params.activityId, { split: false });
	if (!result.ok) return json({ error: 'Kilde ikke funnet' }, { status: 404 });
	return json({ success: true, eventIds: result.eventIds });
};
