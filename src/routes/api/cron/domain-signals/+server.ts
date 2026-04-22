import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { SignalService } from '$lib/server/services/signal-service';

export const config = { maxDuration: 120 };

// Daily/periodic cron endpoint for refreshing cross-domain derived signals.
export const GET: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('authorization');
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const url = new URL(request.url);
		const hoursRaw = Number.parseInt(url.searchParams.get('hours') ?? '168', 10);
		const hours = Number.isFinite(hoursRaw) ? hoursRaw : 168;

		const [result, taskCompletionWeekly, activityRunWeekly] = await Promise.all([
			SignalService.runProducers(),
			SignalService.getObservability('task_completion_weekly', hours),
			SignalService.getObservability('activity_run_pr_week', hours)
		]);

		return json({
			success: true,
			...result,
			observability: {
				taskCompletionWeekly,
				activityRunWeekly
			}
		});
	} catch (error) {
		console.error('Domain signal cron failed:', error);
		return json(
			{ success: false, error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};
