import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SignalService } from '$lib/server/services/signal-service';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';
import { denyUnauthorizedCron } from '$lib/server/cron-guard';

export const config = { maxDuration: 120 };

// Daily/periodic cron endpoint for refreshing cross-domain derived signals.
export const GET: RequestHandler = async ({ request }) => {
	const denied = denyUnauthorizedCron(request);
	if (denied) return denied;

	const result = await withCronTracking('/api/cron/domain-signals', async () => {
		const url = new URL(request.url);
		const hoursRaw = Number.parseInt(url.searchParams.get('hours') ?? '168', 10);
		const hours = Number.isFinite(hoursRaw) ? hoursRaw : 168;

		const [producerResult, taskCompletionWeekly, activityRunWeekly] = await Promise.all([
			SignalService.runProducers(),
			SignalService.getObservability('task_completion_weekly', hours),
			SignalService.getObservability('activity_run_pr_week', hours)
		]);

		return {
			success: true,
			...producerResult,
			observability: {
				taskCompletionWeekly,
				activityRunWeekly
			}
		};
	});

	return json(result);
};
