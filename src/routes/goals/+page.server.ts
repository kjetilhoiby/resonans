import { db } from '$lib/db';
import { goals, sensorEvents } from '$lib/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

const RUNNING_SPORT_TYPES = new Set(['running', 'indoor_running', 'trail_running', 'løp', 'run']);

// Lightweight running distance query for a specific date range — avoids loading 3+ years of data
async function getRunningSummaryForRange(
	userId: string,
	startDate: Date,
	endDate: Date
): Promise<number> {
	const events = await db
		.select({
			distance: sensorEvents.data
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'workout'),
				gte(sensorEvents.timestamp, startDate),
				lte(sensorEvents.timestamp, endDate)
			)
		);

	let totalKm = 0;
	for (const event of events) {
		const data = event.distance as any;
		const sportType = (data?.sportType || '').toLowerCase();
		if (!RUNNING_SPORT_TYPES.has(sportType)) continue;
		const distance = data?.distanceMeters ?? data?.distance;
		if (distance) totalKm += distance > 80 ? distance / 1000 : distance;
	}
	return Math.round(totalKm * 10) / 10;
}

export const load: PageServerLoad = async ({ locals }) => {
	const userGoals = await db.query.goals.findMany({
		where: eq(goals.userId, locals.userId),
		with: {
			category: true,
			tasks: {
				with: {
					progress: {
						orderBy: (progress, { desc }) => [desc(progress.completedAt)],
						limit: 10
					}
				}
			}
		},
		orderBy: (goals, { desc }) => [desc(goals.createdAt)]
	});

	// For goals with running_distance metric and dates, fetch accumulated km
	const runningGoals = userGoals.filter((g) => {
		const meta = g.metadata as any;
		return meta?.metricId === 'running_distance' && (meta?.startDate || meta?.goalTrack);
	});

	let sensorProgressMap: Record<string, { currentKm: number; targetKm: number }> = {};

	// Fetch running km for each goal individually to avoid loading unnecessary historical data
	for (const goal of runningGoals) {
		const meta = goal.metadata as any;
		const startDate = meta?.startDate ? new Date(meta.startDate) : new Date(goal.createdAt);
		const endDate = meta?.endDate ? new Date(meta.endDate) : new Date();
		const targetKm: number = meta?.goalTrack?.targetValue ?? 0;

		const currentKm = await getRunningSummaryForRange(locals.userId, startDate, endDate);
		sensorProgressMap[goal.id] = { currentKm, targetKm };
	}

	return {
		goals: userGoals,
		sensorProgressMap
	};
};
