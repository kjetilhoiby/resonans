import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { eq, and, gte } from 'drizzle-orm';
import { DEFAULT_USER_ID } from '$lib/server/users';
import type { RequestHandler } from './$types';

/**
 * Get cumulative running distance data for year-over-year comparison
 * GET /api/workouts/cumulative-running
 */
export const GET: RequestHandler = async ({ url }) => {
	try {
		const userId = DEFAULT_USER_ID;
		const currentYear = new Date().getFullYear();
		
		// Get years parameter from query string, default to 5
		const years = parseInt(url.searchParams.get('years') || '5');
		const startDate = new Date(currentYear - (years - 1), 0, 1);

		// Fetch all running workouts from the specified number of years
		const workouts = await db.query.sensorEvents.findMany({
			where: and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'workout'),
				gte(sensorEvents.timestamp, startDate)
			),
			orderBy: (events, { asc }) => [asc(events.timestamp)]
		});

		// Filter for running workouts only
		const runningWorkouts = workouts.filter((w) => {
			const sportType = (w.data as any)?.sportType;
			return sportType === 'running' || sportType === 'indoor_running';
		});

		return json(runningWorkouts);
	} catch (error) {
		console.error('Failed to fetch cumulative running data:', error);
		return json({ error: 'Failed to fetch data' }, { status: 500 });
	}
};
