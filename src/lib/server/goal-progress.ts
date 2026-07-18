import { db } from '$lib/db';
import { canonicalWorkouts, categorizedEvents, sensorAggregates, sensorEvents } from '$lib/db/schema';
import { and, desc, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { buildUnifiedWorkoutActivities } from '$lib/server/activity-layer';
import { WorkoutProjectionService } from '$lib/server/services/workout-projection-service';

/**
 * Delt progresjons-lesing for målbare mål. Brukes av både /plan/mal og
 * /plan/drommer (langtidsmål under visjonene) — recompute ved lasting,
 * ingen lagret currentValue å holde i synk.
 */

const RUNNING_SPORT_TYPES = new Set(['running', 'indoor_running', 'trail_running', 'løp', 'run']);

export type RunningSummary = {
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
	const rows = await WorkoutProjectionService.readRunningDailyKmRowsForRange(userId, startDate, endDate);

	return rows.map((row) => ({
		date: row.date.toISOString().slice(0, 10),
		km: Math.round(row.km * 10) / 10
	}));
}

export async function getRunningSummaryForRange(
	userId: string,
	startDate: Date,
	endDate: Date
): Promise<RunningSummary> {
	let dailyKm: { date: string; km: number }[] = [];
	try {
		const freshness = await WorkoutProjectionService.ensureFreshnessForRange(
			userId,
			startDate,
			endDate,
			WorkoutProjectionService.SOFT_STALE_MS,
			WorkoutProjectionService.HARD_STALE_MS,
			{ syncPolicy: 'enqueue_only' }
		);
		console.log(
			`[goal-progress] workout freshness state=${freshness.state} ageMs=${freshness.ageMs ?? 'n/a'} rows=${freshness.rowCount}`
		);

		dailyKm = await readRunningDailyAggregates(userId, startDate, endDate);
	} catch (error) {
		console.warn('[goal-progress] aggregate path unavailable, falling back to deduplicated activity-layer:', error);
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

export type WeightProgress = {
	startDate: string;
	endDate: string;
	currentWeight: number;
	startWeight: number;
	targetWeight: number;
	points: { date: string; weight: number }[];
	pct: number;
};

/** Vektprogresjon for et weight_change-mål: startValue-baseline + målt vekt i vinduet. */
export async function readWeightProgress(
	userId: string,
	args: { startDate: Date; endDate: Date; startWeight: number; targetDelta: number }
): Promise<WeightProgress | null> {
	const { startDate, endDate, startWeight, targetDelta } = args;
	const targetWeight = startWeight + targetDelta;

	const rows = await db
		.select({ timestamp: sensorEvents.timestamp, data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'weight'),
				gte(sensorEvents.timestamp, startDate),
				lte(sensorEvents.timestamp, endDate)
			)
		)
		.orderBy(sensorEvents.timestamp);

	const points = rows
		.map((row) => {
			const weight = Number((row.data as { weight?: number } | null)?.weight);
			if (!Number.isFinite(weight)) return null;
			return {
				date: row.timestamp.toISOString().slice(0, 10),
				weight: Math.round(weight * 10) / 10
			};
		})
		.filter((point): point is { date: string; weight: number } => point !== null);

	const latestPoint = points.length > 0 ? points[points.length - 1] : null;
	if (!latestPoint) return null;

	const currentWeight = latestPoint.weight;
	const totalDelta = targetWeight - startWeight;
	const achievedDelta = currentWeight - startWeight;
	const pct = totalDelta !== 0
		? Math.max(0, Math.min(100, Math.round((achievedDelta / totalDelta) * 100)))
		: 0;

	return {
		startDate: startDate.toISOString().slice(0, 10),
		endDate: endDate.toISOString().slice(0, 10),
		currentWeight,
		startWeight,
		targetWeight,
		points,
		pct
	};
}

/** Siste vektmåling (for startValue på nye vektmål). */
export async function readLatestWeight(userId: string): Promise<number | null> {
	const [latest] = await db
		.select({ data: sensorEvents.data })
		.from(sensorEvents)
		.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'weight')))
		.orderBy(desc(sensorEvents.timestamp))
		.limit(1);
	const weight = Number((latest?.data as { weight?: number } | null)?.weight);
	return Number.isFinite(weight) ? Math.round(weight * 10) / 10 : null;
}

export type TenKBest = {
	bestSeconds: number;
	date: string;
};

/** Beste tid (sekunder) for en bestEfforts-distanse i vinduet — fra canonical_workouts. */
export async function readBestEffort(
	userId: string,
	distanceKey: '1k' | '3k' | '5k' | '10k',
	sinceDays = 90
): Promise<TenKBest | null> {
	const since = new Date(Date.now() - sinceDays * 86_400_000);
	const rows = await db
		.select({ startTime: canonicalWorkouts.startTime, bestEfforts: canonicalWorkouts.bestEfforts })
		.from(canonicalWorkouts)
		.where(
			and(
				eq(canonicalWorkouts.userId, userId),
				gte(canonicalWorkouts.startTime, since),
				isNotNull(canonicalWorkouts.bestEfforts)
			)
		);

	let best: TenKBest | null = null;
	for (const row of rows) {
		const seconds = row.bestEfforts?.[distanceKey];
		if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) continue;
		if (!best || seconds < best.bestSeconds) {
			best = { bestSeconds: Math.round(seconds), date: row.startTime.toISOString().slice(0, 10) };
		}
	}
	return best;
}

/** Beste 10 km-tid (sekunder) i vinduet — beholdt for eksisterende kallere. */
export async function read10kBest(userId: string, sinceDays = 90): Promise<TenKBest | null> {
	return readBestEffort(userId, '10k', sinceDays);
}

/** Hvilepuls-proxy: snitt av søvn-events' hr_average siste `sinceDays` døgn (naps ekskludert implisitt — de mangler oftest puls, og få nok til å ikke skjevfordele). */
export async function readRestingHeartRate(userId: string, sinceDays = 7): Promise<number | null> {
	const since = new Date(Date.now() - sinceDays * 86_400_000);
	const rows = await db
		.select({ data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'sleep'),
				gte(sensorEvents.timestamp, since)
			)
		);
	const values = rows
		.map((row) => Number((row.data as { hr_average?: number } | null)?.hr_average))
		.filter((v) => Number.isFinite(v) && v > 0);
	if (values.length === 0) return null;
	return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
}

export type WeeklyEffortReading = {
	total: number;
	/** 4-ukers baseline-snitt fra aggregatet, null når det mangler */
	p4wAvg: number | null;
	periodKey: string;
};

/** Ukens treningsbelastning fra siste uke-aggregat med weeklyEffort. */
export async function readWeeklyEffort(userId: string): Promise<WeeklyEffortReading | null> {
	const rows = await db.query.sensorAggregates.findMany({
		where: and(eq(sensorAggregates.userId, userId), eq(sensorAggregates.period, 'week')),
		orderBy: [desc(sensorAggregates.startDate)],
		limit: 4
	});
	for (const row of rows) {
		const effort = (row.metrics as { weeklyEffort?: { total?: number; baseline?: { p4wAvg?: number } } } | null)
			?.weeklyEffort;
		if (effort && typeof effort.total === 'number') {
			return {
				total: Math.round(effort.total * 10) / 10,
				p4wAvg: typeof effort.baseline?.p4wAvg === 'number' ? effort.baseline.p4wAvg : null,
				periodKey: row.periodKey
			};
		}
	}
	return null;
}

export type BodyComposition = {
	fatMassKg: number | null;
	muscleMassKg: number | null;
	date: string;
};

/** Siste kroppssammensetning fra Withings-vekta (data.fatMass/muscleMass). */
export async function readBodyComposition(userId: string): Promise<BodyComposition | null> {
	const rows = await db
		.select({ timestamp: sensorEvents.timestamp, data: sensorEvents.data })
		.from(sensorEvents)
		.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'weight')))
		.orderBy(desc(sensorEvents.timestamp))
		.limit(30);
	for (const row of rows) {
		const data = row.data as { fatMass?: number; muscleMass?: number } | null;
		const fat = Number(data?.fatMass);
		const muscle = Number(data?.muscleMass);
		const hasFat = Number.isFinite(fat) && fat > 0;
		const hasMuscle = Number.isFinite(muscle) && muscle > 0;
		if (hasFat || hasMuscle) {
			return {
				fatMassKg: hasFat ? Math.round(fat * 10) / 10 : null,
				muscleMassKg: hasMuscle ? Math.round(muscle * 10) / 10 : null,
				date: row.timestamp.toISOString().slice(0, 10)
			};
		}
	}
	return null;
}

export type MonthlySavings = {
	/** Siste hele kalendermåned, f.eks. '2026-06' */
	lastMonthKey: string;
	lastMonthAmount: number;
	threeMonthAvg: number;
};

/** Månedlig sparebeløp: sum av 'sparing'-kategoriserte transaksjoner (absoluttverdi). */
export async function readMonthlySavings(userId: string, now = new Date()): Promise<MonthlySavings | null> {
	// Vindu: de tre siste hele kalendermånedene
	const windowStart = new Date(now.getFullYear(), now.getMonth() - 3, 1);
	const windowEnd = new Date(now.getFullYear(), now.getMonth(), 1);

	const rows = await db
		.select({ timestamp: categorizedEvents.timestamp, amount: categorizedEvents.amount })
		.from(categorizedEvents)
		.where(
			and(
				eq(categorizedEvents.userId, userId),
				eq(categorizedEvents.resolvedCategory, 'sparing'),
				gte(categorizedEvents.timestamp, windowStart),
				lte(categorizedEvents.timestamp, windowEnd)
			)
		);

	if (rows.length === 0) return null;

	const perMonth = new Map<string, number>();
	for (const row of rows) {
		const key = row.timestamp.toISOString().slice(0, 7);
		const amount = Math.abs(Number(row.amount));
		if (!Number.isFinite(amount)) continue;
		perMonth.set(key, (perMonth.get(key) ?? 0) + amount);
	}

	const lastMonthKey = new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString().slice(0, 7);
	const lastMonthAmount = Math.round(perMonth.get(lastMonthKey) ?? 0);
	const monthTotals = [...perMonth.values()];
	const threeMonthAvg = monthTotals.length > 0
		? Math.round(monthTotals.reduce((s, v) => s + v, 0) / Math.min(3, Math.max(monthTotals.length, 1)))
		: 0;

	return { lastMonthKey, lastMonthAmount, threeMonthAvg };
}
