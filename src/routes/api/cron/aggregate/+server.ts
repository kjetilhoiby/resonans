import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { aggregateAllPeriods } from '$lib/server/integrations/aggregation';

// Aggregation can take a while for many users — allow up to 300 seconds
export const config = { maxDuration: 300 };

/**
 * GET /api/cron/aggregate
 * Runs nightly aggregation (weekly/monthly/yearly rollups) for every user.
 * Triggered by GitHub Actions at 00:00 UTC (see /api/cron/jobs for schedule).
 */
export const GET: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('authorization');
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const users = await db.query.users.findMany();
	console.log(`[aggregate cron] ${users.length} user(s) to aggregate`);

	const results: Record<string, unknown>[] = [];

	for (const user of users) {
		try {
			await aggregateAllPeriods(user.id);
			console.log(`[aggregate cron] user=${user.id} done`);
			results.push({ userId: user.id, success: true });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[aggregate cron] user=${user.id} failed: ${message}`);
			results.push({ userId: user.id, success: false, error: message });
		}
	}

	const succeeded = results.filter((r) => r.success).length;
	const failed = results.filter((r) => !r.success).length;

	return json({ success: true, users: users.length, succeeded, failed, results });
};
