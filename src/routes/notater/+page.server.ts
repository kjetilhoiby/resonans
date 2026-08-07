import type { PageServerLoad } from './$types';
import { searchNotebook } from '$lib/server/writing/search';

/**
 * Notatblokka lastes uten søk — nyeste først fra begge kilder. Søk går videre
 * gjennom /api/notater, så tastingen ikke koster en full sidelasting.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const result = await searchNotebook(locals.userId, { limit: 40 });
	return { hits: result.hits, counts: result.counts };
};
