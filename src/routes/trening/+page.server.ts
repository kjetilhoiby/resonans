import type { PageServerLoad } from './$types';
import { loadTrainingDashboardData } from '$lib/server/training-dashboard';

// Innholdet bor i $lib/server/training-dashboard, delt med Trening-undertemaet
// (/api/tema/[id]/dashboard/training).
//
// Skrivingene som tidligere var form-actions her (`opprett`, `milepael`,
// `nyrute`) ligger nå under /api/tracks/*. Grunnen er at denne ruten skal bli
// en redirect til undertemaet, og en redirect kan ikke ta imot POST.
export const load: PageServerLoad = async ({ locals }) => {
	// Milepæl-evalueringen skriver, og bes om eksplisitt her. Dashboard-
	// endepunktet for undertemaet kaller uten flagget.
	return loadTrainingDashboardData(locals.userId, { evaluateMilestones: true });
};
