import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { processDueBackgroundJobs } from '$lib/server/background-jobs';

export const config = { maxDuration: 120 };

/**
 * GET /api/cron/background-jobs
 * Processes due queued jobs (short worker burst).
 */
export const GET: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('authorization');
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const result = await processDueBackgroundJobs({
		limit: 5,
		workerId: `cron-${new Date().toISOString()}`
	});

	return json({ success: true, ...result });
};
