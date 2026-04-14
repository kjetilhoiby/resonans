import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { syncAllWithingsData } from '$lib/server/integrations/withings-sync';
import { aggregateCurrentPeriods, aggregateAllPeriods, aggregatePeriodsFrom } from '$lib/server/integrations/aggregation';

/**
 * POST /api/sensors/withings/sync
 * 
 * Manually trigger Withings data synchronization
 * Query params:
 *   ?days=N       — sync from N days ago (1–365)
 *   ?from2017=true — full sync from September 2017 (delete + reimport)
 */
export const POST: RequestHandler = async ({ locals, url }) => {
	try {
		const userId = locals.userId;

		const from2017 = url.searchParams.get('from2017') === 'true';
		const daysParam = url.searchParams.get('days');
		const days = daysParam ? Math.max(1, Math.min(365, parseInt(daysParam, 10))) : null;

		let overrideLastSync: Date | undefined;
		if (days) {
			overrideLastSync = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
		}

		const results = await syncAllWithingsData(userId, from2017, overrideLastSync);

		if (from2017) {
			await aggregateAllPeriods(userId);
		} else if (overrideLastSync) {
			await aggregatePeriodsFrom(userId, overrideLastSync);
		} else {
			await aggregateCurrentPeriods(userId);
		}

		return json({ 
			success: true,
			synced: results
		});
	} catch (err) {
		console.error('Withings sync error:', err);
		throw error(500, 'Failed to sync Withings data');
	}
};
