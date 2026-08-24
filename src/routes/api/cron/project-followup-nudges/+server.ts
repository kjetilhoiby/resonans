import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { NudgeOrchestrationService } from '$lib/server/services/nudge-orchestration-service';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';
import { denyUnauthorizedCron } from '$lib/server/cron-guard';

// Timebasert cron: sender lokal-tid purre-nudge for prosjekt-oppfølging (default 09:00).
export const GET: RequestHandler = async ({ request, url }) => {
	const denied = denyUnauthorizedCron(request);
	if (denied) return denied;

	const result = await withCronTracking('/api/cron/project-followup-nudges', async () => {
		const nudgeResult = await NudgeOrchestrationService.runProjectFollowUpNudges({ appUrl: url.origin });
		return { success: true, ...nudgeResult };
	});

	return json(result);
};
