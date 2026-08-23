import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadStreakHistory } from '$lib/server/services/streak-service';

/**
 * GET /api/streaks/[id]/history — dagene bak én streak, for kalenderen i bunnpanelet.
 *
 * Egen rute framfor et felt på `/api/streaks`: dagslistene for alle streaks ville
 * ligget i hver hjem- og temalasting uten at noen hadde åpnet et panel. Historikken
 * hentes når panelet åpnes.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	const history = await loadStreakHistory(locals.userId, params.id);
	if (!history) throw error(404, 'Streak ikke funnet');
	return json(history);
};
