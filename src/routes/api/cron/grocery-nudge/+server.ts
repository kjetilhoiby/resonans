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
 */
export const GET: RequestHandler = async ({ request, url }) => {
	const authHeader = request.headers.get('authorization');
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const result = await withCronTracking('/api/cron/grocery-nudge', async () => {
		const nudgeResult = await sendGroceryWeeklyNudgesForAllUsers(env.ORIGIN ?? url.origin);
		return { success: true, ...nudgeResult };
	});

	return json(result);
};
