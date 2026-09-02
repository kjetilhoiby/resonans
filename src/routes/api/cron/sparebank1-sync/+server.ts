import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { syncAllSparebank1Data } from '$lib/server/integrations/sparebank1-sync';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';
import { denyUnauthorizedCron } from '$lib/server/cron-guard';

/**
 * GET /api/cron/sparebank1-sync
 * Synkroniserer SpareBank 1-data for alle brukere med en aktiv SpareBank 1-sensor.
 * Kjøres automatisk via GitHub Actions (se /api/cron/jobs for schedule).
 */
export const GET: RequestHandler = async ({ request }) => {
	const denied = denyUnauthorizedCron(request);
	if (denied) return denied;

	const result = await withCronTracking('/api/cron/sparebank1-sync', async () => {
		// Find all users with an active SpareBank 1 sensor
		const activeSensors = await db.query.sensors.findMany({
			where: and(eq(sensors.provider, 'sparebank1'), eq(sensors.isActive, true))
		});

		const userIds = [...new Set(activeSensors.map((s) => s.userId))];
		console.log(`[SB1 cron sync] ${userIds.length} user(s) to sync`);

		// Fetch last 2 days to catch any delayed/corrected transactions
		const fromDate = new Date();
		fromDate.setDate(fromDate.getDate() - 2);
		const fromDateStr = fromDate.toISOString().slice(0, 10);

		const results: Record<string, unknown>[] = [];

		for (const userId of userIds) {
			try {
				console.log(`[SB1 cron sync] user=${userId} from=${fromDateStr}…`);
				const synced = await syncAllSparebank1Data(userId, { fromDate });
				const accountList = synced.accountNames.join(', ') || '(ingen)';
				console.log(
					`[SB1 cron sync] user=${userId} done: ${synced.accounts} kontoer (${accountList}), ` +
						`${synced.balanceEvents} saldo-events, ${synced.transactionEvents} transaksjoner`
				);
				results.push({ userId, success: true, synced });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`[SB1 cron sync] user=${userId} failed: ${message}`);
				results.push({ userId, success: false, error: message });
			}
		}

		const succeeded = results.filter((r) => r.success).length;
		const failed = results.filter((r) => !r.success).length;

		return { success: true, fromDate: fromDateStr, users: userIds.length, succeeded, failed, results };
	});

	return json(result);
};
