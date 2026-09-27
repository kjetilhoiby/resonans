import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { reviewTheme } from '$lib/server/ro/ro-service';

/**
 * POST /api/apps/ro/themes/{themeId}/review — den lengre gjennomgangen av ett tema.
 *
 * Foreslås av profilen (`overview.reviewSuggested`) etter noen økter på samme tema.
 * Gjør historikken om til læring: hva trigget før, hva nå, hva er forsøkt, hva har
 * hjulpet, hva står fast.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });
	const review = await reviewTheme(userId, params.id);
	if (!review) return json({ error: 'Review unavailable', code: 'review_unavailable' }, { status: 502 });
	return json({ review });
};
