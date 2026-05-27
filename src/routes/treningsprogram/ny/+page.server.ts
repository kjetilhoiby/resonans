import type { PageServerLoad } from './$types';
import { buildAthleteSnapshot } from '$lib/server/programs/athlete-context';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.userId) return { snapshot: null };
	try {
		const snapshot = await buildAthleteSnapshot(locals.userId);
		return { snapshot };
	} catch (err) {
		console.error('[treningsprogram/ny] snapshot bygging feilet', err);
		return { snapshot: null };
	}
};
