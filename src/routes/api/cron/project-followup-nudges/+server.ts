import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { NudgeOrchestrationService } from '$lib/server/services/nudge-orchestration-service';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';

// Timebasert cron: sender lokal-tid purre-nudge for prosjekt-oppfølging (default 09:00).
export const GET: RequestHandler = async ({ request, url }) => {
	const authHeader = request.headers.get('authorization');
	if (env.VERCEL_ENV && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const result = await withCronTracking('/api/cron/project-followup-nudges', async () => {
		const nudgeResult = await NudgeOrchestrationService.runProjectFollowUpNudges({ appUrl: url.origin });
		return { success: true, ...nudgeResult };
	});

	return json(result);
};
