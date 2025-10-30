import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { sql, and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * Delete walking workouts from database
 * POST /api/admin/cleanup-walking
 */
export const POST: RequestHandler = async () => {
	try {
		console.log('🗑️  Deleting walking workouts...');
		
		// Delete workouts where sportType is walking/indoor_walking/no_activity
		const result = await db.delete(sensorEvents)
			.where(
				and(
					eq(sensorEvents.dataType, 'workout'),
					sql`(
						${sensorEvents.data}->>'sportType' = 'walking' 
						OR ${sensorEvents.data}->>'sportType' = 'indoor_walking'
						OR ${sensorEvents.data}->>'sportType' = 'no_activity'
					)`
				)
			);
		
		console.log('✅ Deleted walking workouts');
		
		return json({ 
			success: true,
			message: 'Walking workouts deleted successfully'
		});
	} catch (error) {
		console.error('Failed to delete walking workouts:', error);
		return json({ 
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error'
		}, { status: 500 });
	}
};
