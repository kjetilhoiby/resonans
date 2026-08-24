import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runHealthCheck, sendMonitoringAlert } from '$lib/server/services/monitoring-service';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';
import { denyUnauthorizedCron } from '$lib/server/cron-guard';

export const GET: RequestHandler = async ({ request }) => {
	const denied = denyUnauthorizedCron(request);
	if (denied) return denied;

	const result = await withCronTracking('/api/cron/monitoring', async () => {
		const health = await runHealthCheck();
		const sent = await sendMonitoringAlert(health);
		return { ...health, alertSent: sent };
	});

	return json(result);
};
