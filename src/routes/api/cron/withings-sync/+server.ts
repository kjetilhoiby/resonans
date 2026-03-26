import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { syncAllWithingsData } from '$lib/server/integrations/withings-sync';

// Allow up to 120 seconds — syncs multiple users sequentially
export const config = { maxDuration: 120 };

/**
 * GET /api/cron/withings-sync
 * Syncs Withings data for every user with an active Withings sensor.
 * Triggered by GitHub Actions (see /api/cron/jobs for schedule).
 * Runs sequentially per user to avoid hammering the Withings API.
 */
export const GET: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('authorization');
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// Find all users with an active Withings sensor
	const withingsSensors = await db.query.sensors.findMany({
		where: and(eq(sensors.provider, 'withings'), eq(sensors.isActive, true))
	});

	const userIds = [...new Set(withingsSensors.map((s) => s.userId))];
	console.log(`[withings-sync cron] ${userIds.length} user(s) to sync`);

	const results: Record<string, unknown>[] = [];

	for (const userId of userIds) {
		try {
			const synced = await syncAllWithingsData(userId, false);
			const total = synced.weight + synced.activity + synced.sleep + synced.workouts;
			console.log(`[withings-sync cron] user=${userId} synced ${total} new events`);
			results.push({ userId, success: true, synced });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[withings-sync cron] user=${userId} failed: ${message}`);
			results.push({ userId, success: false, error: message });
		}
	}

	const succeeded = results.filter((r) => r.success).length;
	const failed = results.filter((r) => !r.success).length;

	return json({ success: true, users: userIds.length, succeeded, failed, results });
};
