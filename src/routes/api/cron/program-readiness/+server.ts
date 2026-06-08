import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { NudgeOrchestrationService } from '$lib/server/services/nudge-orchestration-service';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';

export const GET: RequestHandler = async ({ request, url }) => {
	const authHeader = request.headers.get('authorization');
	if (env.VERCEL_ENV && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const result = await withCronTracking('/api/cron/program-readiness', async () => {
		return NudgeOrchestrationService.runProgramReadinessNudges({
			appUrl: url.origin,
			requireRecentTimeWindow: true,
			windowMinutes: 5
		});
	});
	return json(result);
};
