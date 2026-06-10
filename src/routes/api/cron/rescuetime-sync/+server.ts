import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { RESCUETIME_PROVIDER, syncRescueTime } from '$lib/server/integrations/rescuetime';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';

export const config = { maxDuration: 60 };

/**
 * GET /api/cron/rescuetime-sync
 * Synker RescueTime-data for alle brukere med aktiv RescueTime-sensor.
 * Henter siste 3 dager (upsert per dag) så delvise dager fylles ut over tid.
 * Trigges av GitHub Actions (se /api/cron/jobs for tidspunkt).
 */
export const GET: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('authorization');
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const result = await withCronTracking('/api/cron/rescuetime-sync', async () => {
		const activeSensors = await db.query.sensors.findMany({
			where: and(eq(sensors.provider, RESCUETIME_PROVIDER), eq(sensors.isActive, true))
		});
		const userIds = [...new Set(activeSensors.map((s) => s.userId))];

		const results: Array<Record<string, unknown>> = [];
		for (const userId of userIds) {
			try {
				const synced = await syncRescueTime(userId, { days: 3 });
				results.push({ userId, success: true, ...synced });
			} catch (error) {
				results.push({
					userId,
					success: false,
					error: error instanceof Error ? error.message : String(error)
				});
			}
		}

		const failed = results.filter((r) => !r.success).length;
		return { success: failed === 0, users: userIds.length, failed, results };
	});

	return json(result);
};
