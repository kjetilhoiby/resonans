import type { PageServerLoad } from './$types';
import { getProgramSummaries } from '$lib/server/programs/repository';
import { buildAthleteSnapshot } from '$lib/server/programs/athlete-context';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.userId) {
		return { programs: [], snapshot: null };
	}
	const programs = await getProgramSummaries(locals.userId).catch((err) => {
		console.error('[treningsprogram] getProgramSummaries feilet', err);
		return [];
	});
	const snapshot = await buildAthleteSnapshot(locals.userId).catch((err) => {
		console.error('[treningsprogram] buildAthleteSnapshot feilet', err);
		return null;
	});
	return { programs, snapshot };
};
