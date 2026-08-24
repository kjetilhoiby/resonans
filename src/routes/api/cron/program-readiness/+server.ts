import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { NudgeOrchestrationService } from '$lib/server/services/nudge-orchestration-service';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';
import { denyUnauthorizedCron } from '$lib/server/cron-guard';

export const GET: RequestHandler = async ({ request, url }) => {
	const denied = denyUnauthorizedCron(request);
	if (denied) return denied;

	const result = await withCronTracking('/api/cron/program-readiness', async () => {
		return NudgeOrchestrationService.runProgramReadinessNudges({
			appUrl: url.origin,
			requireRecentTimeWindow: true,
			windowMinutes: 5
		});
	});
	return json(result);
};
