import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { syncTeslaForUser } from '$lib/server/integrations/tesla-sync';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';

type TeslaSyncRow =
	| { userId: string; success: true; asleep: boolean; eventsWritten: number }
	| { userId: string; success: false; error: string };

export const config = { maxDuration: 120 };

/**
 * GET /api/cron/tesla-sync
 * Poller vehicle_data for hver bruker med aktiv Tesla-sensor. Vekker ikke bilen;
 * sover den, registreres en tom (men vellykket) kjøring. Kjøres sjeldnere enn
 * helsesensorene for å ikke holde bilen våken / drenere batteri.
 */
export const GET: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('authorization');
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const result = await withCronTracking('/api/cron/tesla-sync', async () => {
		const teslaSensors = await db.query.sensors.findMany({
			where: and(eq(sensors.provider, 'tesla'), eq(sensors.isActive, true))
		});
		const userIds = [...new Set(teslaSensors.map((s) => s.userId))];
		console.log(`[tesla-sync cron] ${userIds.length} user(s) to sync`);

		const results: TeslaSyncRow[] = [];
		for (const userId of userIds) {
			try {
				const r = await syncTeslaForUser(userId);
				results.push({ userId, success: true, asleep: r.asleep, eventsWritten: r.eventsWritten });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`[tesla-sync cron] user=${userId} failed: ${message}`);
				results.push({ userId, success: false, error: message });
			}
		}

		const succeeded = results.filter((r) => r.success).length;
		const failed = results.filter((r) => !r.success).length;
		return { success: true, users: userIds.length, succeeded, failed, results };
	});

	return json(result);
};
