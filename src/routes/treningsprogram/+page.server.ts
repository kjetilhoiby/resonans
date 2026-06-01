import type { PageServerLoad } from './$types';
import { getProgramSummaries } from '$lib/server/programs/repository';
import { buildAthleteSnapshot } from '$lib/server/programs/athlete-context';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.userId) {
		return { programs: [], snapshot: null };
	}
	const t0 = performance.now();
	const [programs, snapshot] = await Promise.all([
		getProgramSummaries(locals.userId).catch((err) => {
			console.error('[treningsprogram] getProgramSummaries feilet', err);
			return [];
		}),
		buildAthleteSnapshot(locals.userId).catch((err) => {
			console.error('[treningsprogram] buildAthleteSnapshot feilet', err);
			return null;
		})
	]);
	console.log(`[perf][treningsprogram] user=${locals.userId} step=total ms=${(performance.now() - t0).toFixed(0)} programs=${programs.length}`);
	return { programs, snapshot };
};
