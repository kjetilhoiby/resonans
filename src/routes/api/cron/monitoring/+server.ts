import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { runHealthCheck, sendMonitoringAlert } from '$lib/server/services/monitoring-service';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';

export const GET: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('authorization');
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const result = await withCronTracking('/api/cron/monitoring', async () => {
		const health = await runHealthCheck();
		const sent = await sendMonitoringAlert(health);
		return { ...health, alertSent: sent };
	});

	return json(result);
};
