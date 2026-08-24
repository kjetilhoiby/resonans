import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runWeeklyAdaptationsForAllPrograms } from '$lib/server/programs/adaptive-service';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';
import { denyUnauthorizedCron } from '$lib/server/cron-guard';

/**
 * GET /api/cron/adaptive-training
 * Ukentlig justering av programmer i adaptiv modus: evaluerer uken som
 * avsluttes (effort-fordeling på tvers av sportsfamilier), rekalkulerer
 * tempo dempet fra faktiske løp, og flytter neste ukes økter til brukerens
 * vanedager. Kjøres søndag kveld.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	const denied = denyUnauthorizedCron(request);
	if (denied) return denied;

	const result = await withCronTracking('/api/cron/adaptive-training', async () => {
		return runWeeklyAdaptationsForAllPrograms({ appUrl: url.origin });
	});
	return json(result);
};
