import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	enqueueStaleWorkoutProjectionRefreshSweep,
	getGoalIntentParseObservability,
	getTaskIntentParseObservability,
	processDueBackgroundJobs
} from '$lib/server/background-jobs';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';
import { denyUnauthorizedCron } from '$lib/server/cron-guard';

export const config = { maxDuration: 300 };

/**
 * GET /api/cron/background-jobs
 * Processes due queued jobs (short worker burst).
 */
export const GET: RequestHandler = async ({ request }) => {
	const denied = denyUnauthorizedCron(request);
	if (denied) return denied;

	const trackingResult = await withCronTracking('/api/cron/background-jobs', async () => {
		const [result, goalIntentParse, taskIntentParse, workoutSweeper] = await Promise.all([
			processDueBackgroundJobs({
				limit: 50,
				workerId: `cron-${new Date().toISOString()}`
			}),
			getGoalIntentParseObservability(24 * 7),
			getTaskIntentParseObservability(24 * 7),
			enqueueStaleWorkoutProjectionRefreshSweep({
				maxAgeMs: 15 * 60 * 1000,
				limit: 200
			})
		]);

		return { success: true, ...result, workoutSweeper, observability: { goalIntentParse, taskIntentParse } };
	});

	return json(trackingResult);
};
