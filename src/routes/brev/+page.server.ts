import type { PageServerLoad } from './$types';
import { loadHomeLetter } from '$lib/server/home-letter';

/** Prototype — se `docs/changelog/2026-10-06-brev-prototype.md`. */
export const load: PageServerLoad = async ({ locals }) => {
	return await loadHomeLetter(locals.userId);
};
