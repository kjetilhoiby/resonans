import { db } from '$lib/db';
import { goals, sensorEvents, workoutDailyAggregates } from '$lib/db/schema';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { buildUnifiedWorkoutActivities } from '$lib/server/activity-layer';
import { refreshWorkoutProjectionsForRange } from '$lib/server/workout-projections';
import type { PageServerLoad } from './$types';

const RUNNING_SPORT_TYPES = new Set(['running', 'indoor_running', 'trail_running', 'løp', 'run']);
type RunningSummary = {
	currentKm: number;
	startDate: string;
	endDate: string;
	dailyKm: { date: string; km: number }[];
};

async function readRunningDailyAggregates(
	userId: string,
	startDate: Date,
	endDate: Date
): Promise<{ date: string; km: number }[]> {
	const rows = await db
		.select({
			date: workoutDailyAggregates.date,
			distanceMetersSum: workoutDailyAggregates.distanceMetersSum
		})
		.from(workoutDailyAggregates)
		.where(
			and(
				eq(workoutDailyAggregates.userId, userId),
				eq(workoutDailyAggregates.sportFamily, 'running'),
				gte(workoutDailyAggregates.date, startDate),
				lte(workoutDailyAggregates.date, endDate)
			)
		)
		.orderBy(workoutDailyAggregates.date);

	return rows.map((row) => ({
		date: row.date.toISOString().slice(0, 10),
		km: Math.round((Number(row.distanceMetersSum ?? 0) / 1000) * 10) / 10
	}));
}

async function getRunningSummaryForRange(
	userId: string,
	startDate: Date,
	endDate: Date
): Promise<RunningSummary> {
	let dailyKm: { date: string; km: number }[] = [];
	try {
		dailyKm = await readRunningDailyAggregates(userId, startDate, endDate);
		if (dailyKm.length === 0) {
			await refreshWorkoutProjectionsForRange(userId, startDate, endDate);
			dailyKm = await readRunningDailyAggregates(userId, startDate, endDate);
		}
	} catch (error) {
		console.warn('[goals/load] aggregate path unavailable, falling back to deduplicated activity-layer:', error);
		const workouts = await buildUnifiedWorkoutActivities(userId, { since: startDate, limit: 500 });
		const dailyMap = new Map<string, number>();
		for (const w of workouts) {
			const t = new Date(w.startTime);
			if (t > endDate) continue;
			const sport = (w.sportType || '').toLowerCase();
			if (!RUNNING_SPORT_TYPES.has(sport)) continue;
			const km = (w.distanceMeters ?? 0) / 1000;
			if (km <= 0) continue;
			const key = t.toISOString().slice(0, 10);
			dailyMap.set(key, Math.round(((dailyMap.get(key) ?? 0) + km) * 10) / 10);
		}
		dailyKm = Array.from(dailyMap.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([date, km]) => ({ date, km }));
	}

	const currentKm = Math.round(dailyKm.reduce((s, d) => s + d.km, 0) * 10) / 10;
	return {
		currentKm,
		startDate: startDate.toISOString().slice(0, 10),
		endDate: endDate.toISOString().slice(0, 10),
		dailyKm
	};
}

export const load: PageServerLoad = async ({ locals }) => {
	const t0 = performance.now();

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
	console.log(`[goals/load] goals query: ${(performance.now() - t0).toFixed(0)}ms (${userGoals.length} goals)`);

	// For goals with running_distance metric and dates, fetch accumulated km
	const runningGoals = userGoals.filter((g) => {
		const meta = g.metadata as any;
		return meta?.metricId === 'running_distance' && (meta?.startDate || meta?.goalTrack);
	});

	let sensorProgressMap: Record<string, { currentKm: number; targetKm: number; startDate: string; endDate: string; dailyKm: { date: string; km: number }[] }> = {};

	// Fetch running km for each goal individually to avoid loading unnecessary historical data
	for (const goal of runningGoals) {
		const meta = goal.metadata as any;
		const startDate = meta?.startDate ? new Date(meta.startDate) : new Date(goal.createdAt);
		const endDate = meta?.endDate ? new Date(meta.endDate) : new Date();
		const targetKm: number = meta?.goalTrack?.targetValue ?? 0;

		const tRun = performance.now();
		const summary = await getRunningSummaryForRange(locals.userId, startDate, endDate);
		console.log(`[goals/load] running summary "${goal.title}": ${(performance.now() - tRun).toFixed(0)}ms → ${summary.currentKm} km (${summary.dailyKm.length} days with runs)`);
		sensorProgressMap[goal.id] = { ...summary, targetKm };
	}

	// For weight_change goals, fetch the most recent weight measurement
	const weightGoals = userGoals.filter((g) => {
		const meta = g.metadata as any;
		return meta?.metricId === 'weight_change' && typeof meta?.startValue === 'number';
	});

	type WeightProgress = {
		currentWeight: number;
		startWeight: number;
		targetWeight: number;
		pct: number;
	};
	let weightProgressMap: Record<string, WeightProgress> = {};

	for (const goal of weightGoals) {
		const meta = goal.metadata as any;
		const startDate = meta?.startDate ? new Date(meta.startDate) : new Date(goal.createdAt);
		const startWeight: number = meta.startValue;
		const targetDelta: number = meta?.goalTrack?.targetValue ?? 0;
		const targetWeight = startWeight + targetDelta;

		const tW = performance.now();
		const [latest] = await db
			.select({ weight: sensorEvents.data })
			.from(sensorEvents)
			.where(
				and(
					eq(sensorEvents.userId, locals.userId),
					eq(sensorEvents.dataType, 'weight'),
					gte(sensorEvents.timestamp, startDate)
				)
			)
			.orderBy(desc(sensorEvents.timestamp))
			.limit(1);
		console.log(`[goals/load] weight query "${goal.title}": ${(performance.now() - tW).toFixed(0)}ms`);

		if (!latest?.weight?.weight) continue;

		const currentWeight = latest.weight.weight;
		const totalDelta = targetWeight - startWeight;
		const achievedDelta = currentWeight - startWeight;
		const pct = totalDelta !== 0
			? Math.max(0, Math.min(100, Math.round((achievedDelta / totalDelta) * 100)))
			: 0;

		weightProgressMap[goal.id] = { currentWeight, startWeight, targetWeight, pct };
	}

	console.log(`[goals/load] TOTAL: ${(performance.now() - t0).toFixed(0)}ms`);

	return {
		goals: userGoals,
		sensorProgressMap,
		weightProgressMap
	};
};
