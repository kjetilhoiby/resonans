import { loadHealthDashboardData } from '$lib/server/health-dashboard';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	return loadHealthDashboardData(locals.userId);
};
