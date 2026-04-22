import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { NudgeOrchestrationService } from '$lib/server/services/nudge-orchestration-service';

// Hourly cron endpoint: sends local-time nudges for planning day and closing day.
export const GET: RequestHandler = async ({ request, url }) => {
	const authHeader = request.headers.get('authorization');
	if (env.VERCEL_ENV && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const result = await NudgeOrchestrationService.runScheduledNudges(url.origin);
		return json({ success: true, ...result });
	} catch (error) {
		console.error('Day planning nudges failed:', error);
		return json(
			{ success: false, error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};
