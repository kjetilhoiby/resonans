import { json } from '@sveltejs/kit';
import { parseDismissScope, setWorkoutDismissed } from '$lib/server/workouts/dismiss-workout';
import type { RequestHandler } from './$types';

/**
 * POST /api/workouts/[activityId]/dismiss
 * Skjuler en treningsøkt. Økten slettes ikke fra databasen — den vises bare
 * ikke i kanonisk lag og telles ikke med i aggregerte tall.
 *
 * `?scope=source` avviser i stedet én enkelt kilde-registrering; aktiviteten
 * består da på sine gjenværende kilder.
 *
 * Logikken bor i `$lib/server/workouts/dismiss-workout` fordi Ekko går inn
 * samme vei gjennom `/api/apps/workouts/[id]/dismiss`.
 */
export const POST: RequestHandler = async ({ locals, params, url }) => {
	const result = await setWorkoutDismissed(locals.userId, params.activityId, {
		hidden: true,
		scope: parseDismissScope(url.searchParams.get('scope'))
	});

	if (!result.ok) return json({ error: 'Økt ikke funnet' }, { status: 404 });
	return json({ success: true });
};

/**
 * DELETE /api/workouts/[activityId]/dismiss
 * Angrer skjuling av en treningsøkt.
 */
export const DELETE: RequestHandler = async ({ locals, params, url }) => {
	const result = await setWorkoutDismissed(locals.userId, params.activityId, {
		hidden: false,
		scope: parseDismissScope(url.searchParams.get('scope'))
	});

	if (!result.ok) return json({ error: 'Økt ikke funnet' }, { status: 404 });
	return json({ success: true });
};
