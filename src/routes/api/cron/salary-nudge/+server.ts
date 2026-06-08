import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { sendSalaryNudgesForAllUsers } from '$lib/server/salary-nudge';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';

export const config = { maxDuration: 120 };

/**
 * GET /api/cron/salary-nudge
 * Sender lønn-mottatt-nudge til brukere med ny lønnsinngang siste 3 dager.
 * Kjøres 30 min etter sparebank1-sync (schedule: 30 *\/6 * * *).
 */
export const GET: RequestHandler = async ({ request, url }) => {
	const authHeader = request.headers.get('authorization');
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const result = await withCronTracking('/api/cron/salary-nudge', async () => {
		const nudgeResult = await sendSalaryNudgesForAllUsers(url.origin);
		return { success: true, ...nudgeResult };
	});

	return json(result);
};
