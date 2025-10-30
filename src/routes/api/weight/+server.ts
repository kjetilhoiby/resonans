import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { eq, and, gte } from 'drizzle-orm';
import { DEFAULT_USER_ID } from '$lib/server/users';
import type { RequestHandler } from './$types';

/**
 * Get weight data for year-over-year comparison
 * GET /api/weight?years=2
 */
export const GET: RequestHandler = async ({ url }) => {
	try {
		const userId = DEFAULT_USER_ID;
		const currentYear = new Date().getFullYear();
		
		// Get years parameter from query string, default to 2
		const years = parseInt(url.searchParams.get('years') || '2');
		const startDate = new Date(currentYear - (years - 1), 0, 1);

		// Fetch all weight measurements from the specified number of years
		const weightEvents = await db.query.sensorEvents.findMany({
			where: and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'weight'),
				gte(sensorEvents.timestamp, startDate)
			),
			orderBy: (events, { asc }) => [asc(events.timestamp)]
		});

		// Filter out events without weight data
		const validWeightEvents = weightEvents.filter((w) => {
			const weight = (w.data as any)?.weight;
			return weight && weight > 0;
		});

		return json(validWeightEvents);
	} catch (error) {
		console.error('Failed to fetch weight data:', error);
		return json({ error: 'Failed to fetch weight data' }, { status: 500 });
	}
};