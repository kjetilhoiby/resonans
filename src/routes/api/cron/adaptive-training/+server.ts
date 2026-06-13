import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { runWeeklyAdaptationsForAllPrograms } from '$lib/server/programs/adaptive-service';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';

/**
 * GET /api/cron/adaptive-training
 * Ukentlig justering av programmer i adaptiv modus: evaluerer uken som
 * avsluttes (effort-fordeling på tvers av sportsfamilier), rekalkulerer
 * tempo dempet fra faktiske løp, og flytter neste ukes økter til brukerens
 * vanedager. Kjøres søndag kveld.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	const authHeader = request.headers.get('authorization');
	if (env.VERCEL_ENV && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const result = await withCronTracking('/api/cron/adaptive-training', async () => {
		return runWeeklyAdaptationsForAllPrograms({ appUrl: url.origin });
	});
	return json(result);
};
