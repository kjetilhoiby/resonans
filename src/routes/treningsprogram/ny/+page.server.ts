import type { PageServerLoad } from './$types';
import { buildAthleteSnapshot } from '$lib/server/programs/athlete-context';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.userId) return { snapshot: null };
	const snapshot = await buildAthleteSnapshot(locals.userId);
	return { snapshot };
};
