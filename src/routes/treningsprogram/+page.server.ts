import type { PageServerLoad } from './$types';
import { getProgramSummaries } from '$lib/server/programs/repository';
import { buildAthleteSnapshot } from '$lib/server/programs/athlete-context';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.userId) {
		return { programs: [], snapshot: null };
	}
	const [programs, snapshot] = await Promise.all([
		getProgramSummaries(locals.userId),
		buildAthleteSnapshot(locals.userId)
	]);
	return { programs, snapshot };
};
