import type { PageServerLoad } from './$types';
import { loadHomeLetter } from '$lib/server/home-letter';
import { getHomeLetterProse } from '$lib/server/home-letter-prose';
import { osloDayKey } from '$lib/domain/oslo-time';

/**
 * Prototype — se `docs/changelog/2026-10-06-brev-prototype.md`.
 *
 * Modellbrevet returneres som et UAVVENTET løfte, så SvelteKit strømmer det:
 * regelbrevet vises med det samme, og modellteksten kommer når den er klar. Et
 * kall som henger skal ikke holde den regelbaserte siden igjen.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const payload = await loadHomeLetter(locals.userId);
	return {
		...payload,
		prose: getHomeLetterProse(locals.userId, payload.letter, osloDayKey(new Date()))
	};
};
