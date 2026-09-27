import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProfile } from '$lib/server/ro/ro-service';

/**
 * GET /api/apps/ro/profile — oversikten i Ro (docs/ekko-ro.md).
 *
 * Observasjoner, ikke prestasjon: antall økter siste 30 dager, temaene, det
 * brukeren selv har sagt virker, og aksepterte hypoteser. Ingen score og ingen
 * streak – med vilje.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });
	return json(await getProfile(userId));
};
