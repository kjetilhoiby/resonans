import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { sendGroceryWeeklyNudgesForAllUsers } from '$lib/server/grocery-nudge';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';

export const config = { maxDuration: 120 };

/**
 * GET /api/cron/grocery-nudge
 * Ukentlig dagligvare-oppsummering (mandag, lokal tid per bruker, 60-min vindu).
 * Kjøres hver time; nudgen selv gater på ukedag + klokkeslett + dedup.
 * ?force=1 hopper over ukedag/tid/dedup — for manuell verifisering.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	const authHeader = request.headers.get('authorization');
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const force = url.searchParams.get('force') === '1';

	const result = await withCronTracking('/api/cron/grocery-nudge', async () => {
		const nudgeResult = await sendGroceryWeeklyNudgesForAllUsers(env.ORIGIN ?? url.origin, new Date(), { force });
		return { success: true, ...nudgeResult };
	});

	return json(result);
};
