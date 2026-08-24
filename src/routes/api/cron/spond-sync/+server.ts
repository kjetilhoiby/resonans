import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { syncSpondData } from '$lib/server/integrations/spond-sync';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';
import { denyUnauthorizedCron } from '$lib/server/cron-guard';

export const GET: RequestHandler = async ({ request }) => {
	const denied = denyUnauthorizedCron(request);
	if (denied) return denied;

	const result = await withCronTracking('/api/cron/spond-sync', async () => {
		const activeSensors = await db.query.sensors.findMany({
			where: and(eq(sensors.provider, 'spond'), eq(sensors.isActive, true))
		});

		const userIds = [...new Set(activeSensors.map((s) => s.userId))];
		console.log(`[spond-sync cron] ${userIds.length} bruker(e) å synke`);

		let succeeded = 0;
		let failed = 0;

		for (const userId of userIds) {
			try {
				const r = await syncSpondData(userId);
				console.log(`[spond-sync cron] user=${userId} ok: ${r.events} hendelser fra ${r.groups} grupper`);
				succeeded++;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`[spond-sync cron] user=${userId} feilet: ${msg}`);
				failed++;
			}
		}

		return { success: true, users: userIds.length, succeeded, failed };
	});

	return json(result);
};
