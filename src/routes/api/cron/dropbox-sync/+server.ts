import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { syncDropboxWorkoutsForAllUsers } from '$lib/server/integrations/dropbox-sync';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';
import { denyUnauthorizedCron } from '$lib/server/cron-guard';

export const config = { maxDuration: 120 };

export const GET: RequestHandler = async ({ request, url }) => {
	const denied = denyUnauthorizedCron(request);
	if (denied) return denied;

	const trackingResult = await withCronTracking('/api/cron/dropbox-sync', async () => {
		const result = await syncDropboxWorkoutsForAllUsers({ appUrl: url.origin });
		const failed = result.results.filter((r) => r.success === false).length;
		return {
			success: true,
			users: result.users,
			failed,
			results: result.results
		};
	});

	return json(trackingResult);
};
