import { db } from '$lib/db';
import { sensorAggregates } from '$lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { DEFAULT_USER_ID } from '$lib/server/users';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const userId = DEFAULT_USER_ID;

	// Get recent weekly aggregates (last 12 weeks)
	const weeklyData = await db.query.sensorAggregates.findMany({
		where: and(
			eq(sensorAggregates.userId, userId),
			eq(sensorAggregates.period, 'week')
		),
		orderBy: [desc(sensorAggregates.startDate)],
		limit: 12
	});

	// Get recent monthly aggregates (last 12 months)
	const monthlyData = await db.query.sensorAggregates.findMany({
		where: and(
			eq(sensorAggregates.userId, userId),
			eq(sensorAggregates.period, 'month')
		),
		orderBy: [desc(sensorAggregates.startDate)],
		limit: 12
	});

	// Get yearly aggregates
	const yearlyData = await db.query.sensorAggregates.findMany({
		where: and(
			eq(sensorAggregates.userId, userId),
			eq(sensorAggregates.period, 'year')
		),
		orderBy: [desc(sensorAggregates.startDate)]
	});

	return {
		weekly: weeklyData.reverse(), // Most recent last for chart display
		monthly: monthlyData.reverse(),
		yearly: yearlyData.reverse()
	};
};
