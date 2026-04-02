import { json } from '@sveltejs/kit';
import { buildUnifiedWorkoutActivities } from '$lib/server/activity-layer';
import type { RequestHandler } from './$types';

/**
 * Get cumulative running distance data for year-over-year comparison
 * GET /api/workouts/cumulative-running
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		const userId = locals.userId;
		const currentYear = new Date().getFullYear();
		
		// Get years parameter from query string, default to 5
		const years = parseInt(url.searchParams.get('years') || '5');
		const startDate = new Date(currentYear - (years - 1), 0, 1);

		const workouts = await buildUnifiedWorkoutActivities(userId, {
			since: startDate,
			limit: 5000
		});

		// Filter for running workouts only
		const runningWorkouts = workouts.filter((w) => {
			const sportType = (w.sportType || '').toLowerCase();
			return sportType === 'running' || sportType === 'indoor_running';
		}).map((w) => ({
			id: w.activityId,
			timestamp: w.startTime,
			data: {
				sportType: w.sportType,
				distance: w.distanceMeters ?? undefined
			}
		}));

		return json(runningWorkouts);
	} catch (error) {
		console.error('Failed to fetch cumulative running data:', error);
		return json({ error: 'Failed to fetch data' }, { status: 500 });
	}
};
