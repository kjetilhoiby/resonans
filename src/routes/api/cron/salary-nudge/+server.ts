import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sendSalaryNudgesForAllUsers } from '$lib/server/salary-nudge';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';
import { denyUnauthorizedCron } from '$lib/server/cron-guard';

/**
 * GET /api/cron/salary-nudge
 * Sender lønn-mottatt-nudge til brukere med ny lønnsinngang siste 3 dager.
 * Kjøres 30 min etter sparebank1-sync (schedule: 30 *\/6 * * *).
 */
export const GET: RequestHandler = async ({ request, url }) => {
	const denied = denyUnauthorizedCron(request);
	if (denied) return denied;

	const result = await withCronTracking('/api/cron/salary-nudge', async () => {
		const nudgeResult = await sendSalaryNudgesForAllUsers(url.origin);
		return { success: true, ...nudgeResult };
	});

	return json(result);
};
