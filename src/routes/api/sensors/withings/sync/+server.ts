import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { syncAllWithingsData } from '$lib/server/integrations/withings-sync';
import { aggregateAllPeriods } from '$lib/server/integrations/aggregation';

/**
 * POST /api/sensors/withings/sync
 * 
 * Manually trigger Withings data synchronization
 */
export const POST: RequestHandler = async ({ locals }) => {
	try {
		const userId = locals.userId;
		
		const results = await syncAllWithingsData(userId);
		
		// Automatically aggregate after successful sync
		await aggregateAllPeriods(userId);
		
		return json({ 
			success: true,
			synced: results
		});
	} catch (err) {
		console.error('Withings sync error:', err);
		throw error(500, 'Failed to sync Withings data');
	}
};
