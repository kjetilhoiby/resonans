import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { NudgeOrchestrationService } from '$lib/server/services/nudge-orchestration-service';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';

// Hourly cron endpoint: sends local-time nudges for planning day and closing day.
export const GET: RequestHandler = async ({ request, url }) => {
	const authHeader = request.headers.get('authorization');
	if (env.VERCEL_ENV && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const result = await withCronTracking('/api/cron/day-planning-nudges', async () => {
		const nudgeResult = await NudgeOrchestrationService.runScheduledNudges(url.origin);
		return { success: true, ...nudgeResult };
	});

	return json(result);
};
