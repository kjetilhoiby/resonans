import { db } from '$lib/db';
import { goals } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getRunningSummaryForRange, readWeightProgress, type WeightProgress } from '$lib/server/goal-progress';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const t0 = performance.now();
	const userId = locals.userId;

	const userGoals = await db.query.goals.findMany({
		where: eq(goals.userId, userId),
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
	console.log(`[perf][goals/load] user=${userId} step=goals_query ms=${(performance.now() - t0).toFixed(0)} count=${userGoals.length}`);

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
		const summary = await getRunningSummaryForRange(userId, startDate, endDate);
		console.log(`[perf][goals/load] user=${userId} step=running_summary ms=${(performance.now() - tRun).toFixed(0)} goal=${goal.id} days=${summary.dailyKm.length}`);
		sensorProgressMap[goal.id] = { ...summary, targetKm };
	}

	// For weight_change goals, fetch the most recent weight measurement
	const weightGoals = userGoals.filter((g) => {
		const meta = g.metadata as any;
		return meta?.metricId === 'weight_change' && typeof meta?.startValue === 'number';
	});

	let weightProgressMap: Record<string, WeightProgress> = {};

	for (const goal of weightGoals) {
		const meta = goal.metadata as any;
		const startDate = meta?.startDate ? new Date(meta.startDate) : new Date(goal.createdAt);
		const endDate = meta?.endDate ? new Date(meta.endDate) : (goal.targetDate ? new Date(goal.targetDate) : new Date());

		const tW = performance.now();
		const progress = await readWeightProgress(userId, {
			startDate,
			endDate,
			startWeight: meta.startValue,
			targetDelta: meta?.goalTrack?.targetValue ?? 0
		});
		console.log(`[perf][goals/load] user=${userId} step=weight_query ms=${(performance.now() - tW).toFixed(0)} goal=${goal.id}`);
		if (progress) weightProgressMap[goal.id] = progress;
	}

	console.log(`[perf][goals/load] user=${userId} step=total ms=${(performance.now() - t0).toFixed(0)} goals=${userGoals.length}`);

	return {
		goals: userGoals,
		sensorProgressMap,
		weightProgressMap
	};
};
