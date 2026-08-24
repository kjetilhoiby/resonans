import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { NudgeOrchestrationService } from '$lib/server/services/nudge-orchestration-service';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';
import { denyUnauthorizedCron } from '$lib/server/cron-guard';

// Hourly cron endpoint: sends local-time nudges for planning day and closing day.
export const GET: RequestHandler = async ({ request, url }) => {
	const denied = denyUnauthorizedCron(request);
	if (denied) return denied;

	const result = await withCronTracking('/api/cron/day-planning-nudges', async () => {
		const nudgeResult = await NudgeOrchestrationService.runScheduledNudges(url.origin);
		return { success: true, ...nudgeResult };
	});

	return json(result);
};
