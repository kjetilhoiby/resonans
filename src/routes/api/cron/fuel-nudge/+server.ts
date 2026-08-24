import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { sendFuelNudgesForAllUsers } from '$lib/server/fuel-nudge';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';
import { denyUnauthorizedCron } from '$lib/server/cron-guard';

export const config = { maxDuration: 120 };

/**
 * GET /api/cron/fuel-nudge
 *
 * Sier fra når inntaket ligger bak — særlig etter en økt. Kjøres hver time;
 * nudgen selv gater på klokkeslett (10–20 Oslo), på at et kcal-mål finnes, og på
 * at den ikke alt er sendt i dag.
 *
 * `?force=1` hopper over dedup, til manuell verifisering.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	const denied = denyUnauthorizedCron(request);
	if (denied) return denied;

	const force = url.searchParams.get('force') === '1';

	const result = await withCronTracking('/api/cron/fuel-nudge', async () => {
		const nudgeResult = await sendFuelNudgesForAllUsers(env.ORIGIN ?? url.origin, new Date(), {
			force
		});
		return { success: true, ...nudgeResult };
	});

	return json(result);
};
