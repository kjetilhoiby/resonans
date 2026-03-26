import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { syncAllSparebank1Data } from '$lib/server/integrations/sparebank1-sync';

// Allow up to 120 seconds — syncs multiple users sequentially
export const config = { maxDuration: 120 };

/**
 * GET /api/cron/sparebank1-sync
 * Synkroniserer SpareBank 1-data for alle brukere med en aktiv SpareBank 1-sensor.
 * Kjøres automatisk via GitHub Actions (se /api/cron/jobs for schedule).
 */
export const GET: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('authorization');
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

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
			console.log(
				`[SB1 cron sync] user=${userId} done: ${synced.accounts} kontoer, ` +
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

	return json({ success: true, fromDate: fromDateStr, users: userIds.length, succeeded, failed, results });
};
