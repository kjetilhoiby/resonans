import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { aggregateAllPeriods } from '$lib/server/integrations/aggregation';

/**
 * POST /api/sensors/aggregate
 * 
 * Manually trigger aggregation of sensor data
 */
export const POST: RequestHandler = async ({ locals }) => {
	try {
		const userId = locals.userId;
		
		await aggregateAllPeriods(userId);
		
		return json({ 
			success: true,
			message: 'Aggregation completed'
		});
	} catch (err) {
		console.error('Aggregation error:', err);
		throw error(500, 'Failed to aggregate sensor data');
	}
};
