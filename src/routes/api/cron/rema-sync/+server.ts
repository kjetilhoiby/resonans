import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { syncRemaForUser, REMA_PROVIDER } from '$lib/server/integrations/rema-sync';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';
import { denyUnauthorizedCron } from '$lib/server/cron-guard';

type RemaSyncRow =
	| { userId: string; success: true; imported: number; remaining: number; failedReceipts: number }
	| { userId: string; success: false; error: string };

/**
 * GET /api/cron/rema-sync
 * Henter nye Rema 1000-kvitteringer for hver bruker med aktiv Rema-sensor.
 * `failed` teller BRUKERE der synken feilet, så kjøringen blir `partial`
 * (classifyCronResult) når en innlogging har dødd.
 */
export const GET: RequestHandler = async ({ request }) => {
	const denied = denyUnauthorizedCron(request);
	if (denied) return denied;

	const result = await withCronTracking('/api/cron/rema-sync', async () => {
		const rows = await db.query.sensors.findMany({
			where: and(eq(sensors.provider, REMA_PROVIDER), eq(sensors.isActive, true))
		});
		const userIds = [...new Set(rows.map((s) => s.userId))];

		const results: RemaSyncRow[] = [];
		for (const userId of userIds) {
			try {
				const r = await syncRemaForUser(userId);
				results.push({ userId, success: true, imported: r.imported, remaining: r.remaining, failedReceipts: r.failed });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`[rema-sync cron] user=${userId} feilet: ${message}`);
				results.push({ userId, success: false, error: message });
			}
		}

		const failed = results.filter((r) => !r.success).length;
		return { success: true, users: userIds.length, succeeded: results.length - failed, failed, results };
	});

	return json(result);
};
