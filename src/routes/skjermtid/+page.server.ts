import type { PageServerLoad } from './$types';
import { loadScreenTimeDashboardData } from '$lib/server/screentime-dashboard';

// Innholdet bor i $lib/server/screentime-dashboard, delt med
// Skjermtid-undertemaet (/api/tema/[id]/dashboard/screentime).
export const load: PageServerLoad = async ({ locals }) => {
	return loadScreenTimeDashboardData(locals.userId);
};
