import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { syncAllWithingsData } from '$lib/server/integrations/withings-sync';
import { aggregateAllPeriods } from '$lib/server/integrations/aggregation';

/**
 * POST /api/sensors/withings/full-sync
 * 
 * Full sync: Delete all data and re-sync everything from September 1, 2017
 */
export const POST: RequestHandler = async ({ locals }) => {
	try {
		const userId = locals.userId;
		
		console.log('🔄 Starting full sync from September 1, 2017...');
		const results = await syncAllWithingsData(userId, true);
		
		console.log('📊 Synced:', results);
		console.log('🔄 Aggregating all periods...');
		
		// Automatically aggregate after successful sync
		await aggregateAllPeriods(userId);
		
		console.log('✅ Full sync completed!');
		
		return json({ 
			success: true,
			synced: results,
			message: 'Full sync completed from September 1, 2017'
		});
	} catch (err) {
		console.error('Full sync error:', err);
		throw error(500, 'Failed to complete full sync');
	}
};
