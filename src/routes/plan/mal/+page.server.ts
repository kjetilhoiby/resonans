import { db } from '$lib/db';
import { goals } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import {
	getRunningSummaryForRange,
	readBestEffort,
	readBodyComposition,
	readCategorySpend,
	readRestingHeartRate,
	readWeeklyEffort,
	readWeightProgress,
	type WeightProgress
} from '$lib/server/goal-progress';
import { buildMetricGoalEval, type MetricGoalEval } from '$lib/domain/metric-goal-eval';
import { readGoalTargetValue } from '$lib/domain/goal-tracks';

/** grocery_spend er category_spend bundet til denne kategorien. */
const GROCERY_CATEGORY = 'dagligvarer';
import { METRIC_CATALOG, type MetricId } from '$lib/domain/metric-catalog';
import {
	evaluateScreenTimeGoal,
	getLatestScreenTimeWeekMetrics,
	readScreenTimeGoalMetadata
} from '$lib/server/integrations/screen-time-goals';
import { readSleepNights } from '$lib/server/integrations/sleep-goals';
import { readParentTimeForChild } from '$lib/server/services/parent-time-service';
import { evaluateSleepGoal, readSleepGoalMetadata, type SleepGoalEval } from '$lib/domain/sleep-goals';
import type { ScreenTimeGoalEval } from '$lib/components/domain/plan/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const t0 = performance.now();
	const userId = locals.userId;

	const allGoals = await db.query.goals.findMany({
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
	// Internt maskineri («Planlegging»-målet for oppgavekobling) skal aldri vises
	const userGoals = allGoals.filter((g) => !(g.metadata as any)?.isPlanningGoal);
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

	// For weight_change goals, fetch the most recent weight measurement.
	// NB: `startValue` er IKKE et krav her. Mål opprettet uten baseline (chatten kunne
	// ikke sende den før 23. august 2026) ble ellers filtrert bort i det stille og
	// havnet under «Uten måling»; `readWeightProgress` faller tilbake på første
	// måling i vinduet. Målverdien må finnes — uten den er det ingenting å måle mot.
	const weightGoals = userGoals
		.map((g) => ({ goal: g, targetValue: readGoalTargetValue(g.metadata) }))
		.filter(
			(g): g is { goal: (typeof userGoals)[number]; targetValue: number } =>
				(g.goal.metadata as any)?.metricId === 'weight_change' && g.targetValue !== null
		);

	let weightProgressMap: Record<string, WeightProgress> = {};

	for (const { goal, targetValue } of weightGoals) {
		const meta = goal.metadata as any;
		const startDate = meta?.startDate ? new Date(meta.startDate) : new Date(goal.createdAt);
		const endDate = meta?.endDate ? new Date(meta.endDate) : (goal.targetDate ? new Date(goal.targetDate) : new Date());

		const tW = performance.now();
		const progress = await readWeightProgress(userId, {
			startDate,
			endDate,
			startWeight: typeof meta?.startValue === 'number' ? meta.startValue : null,
			targetValue
		});
		console.log(`[perf][goals/load] user=${userId} step=weight_query ms=${(performance.now() - tW).toFixed(0)} goal=${goal.id}`);
		if (progress) weightProgressMap[goal.id] = progress;
	}

	// Skjermtidsmål: evaluer mot nyeste uke med data (samme maskineri som /skjermtid)
	const screenTimeGoals = userGoals
		.map((g) => ({ row: g, stGoal: readScreenTimeGoalMetadata(g.metadata) }))
		.filter((g): g is { row: (typeof userGoals)[number]; stGoal: NonNullable<ReturnType<typeof readScreenTimeGoalMetadata>> } => g.stGoal !== null);
	let screenTimeEvalMap: Record<string, ScreenTimeGoalEval> = {};
	if (screenTimeGoals.length > 0) {
		const tSt = performance.now();
		const { thisWeek, prevWeek } = await getLatestScreenTimeWeekMetrics(userId);
		for (const { row: goal, stGoal } of screenTimeGoals) {
			const evaluated = evaluateScreenTimeGoal(
				{ id: goal.id, title: goal.title, description: goal.description, goal: stGoal },
				thisWeek,
				prevWeek
			);
			screenTimeEvalMap[goal.id] = {
				currentMinutes: evaluated.currentMinutes,
				targetMinutes: evaluated.targetMinutes,
				withinTarget: evaluated.withinTarget,
				pct: evaluated.pct,
				deltaMinutes: evaluated.deltaMinutes,
				basisLabel: evaluated.basisLabel
			};
		}
		console.log(`[perf][goals/load] user=${userId} step=screen_time ms=${(performance.now() - tSt).toFixed(0)} goals=${screenTimeGoals.length}`);
	}

	// Generiske målbare mål (hvilepuls, belastning, 5k/10k, fett-/muskelmasse):
	// nåverdi leses per metrikk, sone-evaluering bygges i domenelogikken
	const GENERIC_METRICS = new Set<MetricId>([
		'running_10k_time',
		'running_5k_time',
		'resting_heart_rate',
		'weekly_effort',
		'fat_mass',
		'muscle_mass',
		'category_spend',
		// grocery_spend ER category_spend for dagligvarer. Metrikken sto i katalogen, i
		// viz-spec og i create_goal-beskrivelsen uten noen leser, så et mål opprettet på den
		// viste ingen nåverdi i det hele tatt. Se fase 7 i changeloggen.
		'grocery_spend',
		'parent_time'
	]);
	let metricEvalMap: Record<string, MetricGoalEval> = {};
	const metricGoals = userGoals.filter((g) => {
		const meta = g.metadata as any;
		return (
			GENERIC_METRICS.has(meta?.metricId) &&
			typeof meta?.goalTrack?.targetValue === 'number' &&
			g.status !== 'archived'
		);
	});
	if (metricGoals.length > 0) {
		const tM = performance.now();
		// Hent hver kilde maks én gang uansett antall mål
		const needed = new Set(metricGoals.map((g) => (g.metadata as any).metricId as MetricId));
		const [best5k, best10k, restingHr, weeklyEffort, bodyComp] = await Promise.all([
			needed.has('running_5k_time') ? readBestEffort(userId, '5k') : null,
			needed.has('running_10k_time') ? readBestEffort(userId, '10k') : null,
			needed.has('resting_heart_rate') ? readRestingHeartRate(userId) : null,
			needed.has('weekly_effort') ? readWeeklyEffort(userId) : null,
			needed.has('fat_mass') || needed.has('muscle_mass') ? readBodyComposition(userId) : null
		]);

		// Kategori-forbruk: hver distinkt kategori leses maks én gang
		const spendCategories = new Set(
			metricGoals
				.filter((g) => (g.metadata as any).metricId === 'category_spend')
				.map((g) => (g.metadata as any).spendCategory)
				.filter((c): c is string => typeof c === 'string' && c.length > 0)
		);
		// grocery_spend leses gjennom samme leser, med kategorien bundet.
		if (metricGoals.some((g) => (g.metadata as any).metricId === 'grocery_spend')) {
			spendCategories.add(GROCERY_CATEGORY);
		}
		const categorySpendMap = new Map(
			await Promise.all(
				[...spendCategories].map(
					async (cat) => [cat, await readCategorySpend(userId, cat)] as const
				)
			)
		);

		// Foreldretid: hvert distinkt barn leses maks én gang (timer siste uke)
		const childNames = new Set(
			metricGoals
				.filter((g) => (g.metadata as any).metricId === 'parent_time')
				.map((g) => (g.metadata as any).childName)
				.filter((c): c is string => typeof c === 'string' && c.length > 0)
		);
		const parentTimeMap = new Map(
			await Promise.all(
				[...childNames].map(async (name) => [name, await readParentTimeForChild(userId, name)] as const)
			)
		);

		for (const goal of metricGoals) {
			const meta = goal.metadata as any;
			const metricId = meta.metricId as MetricId;
			const target: number = meta.goalTrack.targetValue;
			let current: number | null = null;
			let contextLabel: string | null = null;
			switch (metricId) {
				case 'running_5k_time':
					current = best5k?.bestSeconds ?? null;
					if (best5k) contextLabel = `beste økt ${best5k.date}`;
					break;
				case 'running_10k_time':
					current = best10k?.bestSeconds ?? null;
					if (best10k) contextLabel = `beste økt ${best10k.date}`;
					break;
				case 'resting_heart_rate':
					current = restingHr;
					contextLabel = 'snitt under søvn siste 7 netter';
					break;
				case 'weekly_effort':
					current = weeklyEffort?.total ?? null;
					if (weeklyEffort?.p4wAvg != null) contextLabel = `4-ukers snitt: ${weeklyEffort.p4wAvg}`;
					break;
				case 'fat_mass':
					current = bodyComp?.fatMassKg ?? null;
					if (bodyComp) contextLabel = `målt ${bodyComp.date}`;
					break;
				case 'muscle_mass':
					current = bodyComp?.muscleMassKg ?? null;
					if (bodyComp) contextLabel = `målt ${bodyComp.date}`;
					break;
				case 'category_spend': {
					const cat = meta.spendCategory as string | undefined;
					const spend = cat ? categorySpendMap.get(cat) : null;
					current = spend?.currentMonth ?? null;
					if (spend?.threeMonthAvg != null) contextLabel = `3-mnd snitt: ${spend.threeMonthAvg} kr/mnd`;
					else contextLabel = 'hittil i måneden';
					break;
				}
				case 'grocery_spend': {
					const spend = categorySpendMap.get(GROCERY_CATEGORY);
					current = spend?.currentMonth ?? null;
					if (spend?.threeMonthAvg != null)
						contextLabel = `3-mnd snitt: ${spend.threeMonthAvg} kr/mnd`;
					else contextLabel = 'hittil i måneden';
					break;
				}
				case 'parent_time': {
					const child = meta.childName as string | undefined;
					current = child ? (parentTimeMap.get(child) ?? null) : null;
					contextLabel = child ? `med ${child}, siste uke` : 'siste uke';
					break;
				}
			}
			metricEvalMap[goal.id] = buildMetricGoalEval({
				metricId,
				direction: METRIC_CATALOG[metricId].direction,
				current,
				target,
				unit: meta.goalTrack.unit || METRIC_CATALOG[metricId].defaultUnit,
				contextLabel
			});
		}
		console.log(`[perf][goals/load] user=${userId} step=metric_evals ms=${(performance.now() - tM).toFixed(0)} goals=${metricGoals.length}`);
	}

	// Søvnmål: evaluer mot netter fra siste ~7 døgn (naps skilles ut i domenelogikken)
	const sleepGoals = userGoals
		.map((g) => ({ row: g, sleepGoal: readSleepGoalMetadata(g.metadata) }))
		.filter((g): g is { row: (typeof userGoals)[number]; sleepGoal: NonNullable<ReturnType<typeof readSleepGoalMetadata>> } => g.sleepGoal !== null);
	let sleepEvalMap: Record<string, SleepGoalEval> = {};
	if (sleepGoals.length > 0) {
		const tSl = performance.now();
		const nights = await readSleepNights(userId);
		for (const { row: goal, sleepGoal } of sleepGoals) {
			sleepEvalMap[goal.id] = evaluateSleepGoal(sleepGoal, nights);
		}
		console.log(`[perf][goals/load] user=${userId} step=sleep ms=${(performance.now() - tSl).toFixed(0)} goals=${sleepGoals.length} nights=${nights.length}`);
	}

	console.log(`[perf][goals/load] user=${userId} step=total ms=${(performance.now() - t0).toFixed(0)} goals=${userGoals.length}`);

	return {
		goals: userGoals,
		sensorProgressMap,
		weightProgressMap,
		screenTimeEvalMap,
		sleepEvalMap,
		metricEvalMap
	};
};
