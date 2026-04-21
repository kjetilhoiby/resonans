import { db } from '$lib/db';
import { canonicalWorkouts, workoutDailyAggregates } from '$lib/db/schema';
import { and, eq, gte, lte } from 'drizzle-orm';
import { buildUnifiedWorkoutActivities } from '$lib/server/activity-layer';

export type WorkoutProjectionRefreshResult = {
	canonicalCount: number;
	dailyCount: number;
};

function sportFamily(value: string): string {
	if (value.includes('running') || value === 'løp' || value === 'run') return 'running';
	if (value.includes('cycling') || value === 'e_bike') return 'cycling';
	if (value.includes('walking') || value === 'hiking') return 'walking';
	if (value.includes('swimming')) return 'swimming';
	return value || 'workout';
}

function utcDay(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function refreshWorkoutProjectionsForRange(
	userId: string,
	startDate: Date,
	endDate: Date
): Promise<WorkoutProjectionRefreshResult> {
	const t0 = performance.now();
	const unified = await buildUnifiedWorkoutActivities(userId, { since: startDate, limit: 2000 });
	const inRange = unified.filter((w) => new Date(w.startTime) <= endDate);

	const canonicalRows = inRange.map((w) => ({
		userId,
		startTime: new Date(w.startTime),
		sportType: w.sportType,
		sportFamily: sportFamily(w.sportType),
		distanceMeters: w.distanceMeters !== null ? String(w.distanceMeters) : null,
		durationSeconds: w.durationSeconds !== null ? String(w.durationSeconds) : null,
		avgHeartRate: w.avgHeartRate !== null ? String(w.avgHeartRate) : null,
		maxHeartRate: w.maxHeartRate !== null ? String(w.maxHeartRate) : null,
		sourceCount: w.evidenceCount,
		sourceProviders: w.sources,
		evidence: w.evidence.map((e) => ({
			eventId: e.eventId,
			sensorId: e.sensorId,
			provider: e.provider,
			sensorType: e.sensorType,
			timestamp: e.timestamp
		})),
		updatedAt: new Date()
	}));

	const dailyMap = new Map<string, {
		date: Date;
		sportFamily: string;
		count: number;
		distanceMetersSum: number;
		durationSecondsSum: number;
		avgHeartRateValues: number[];
		maxHeartRateMax: number;
	}>();

	for (const row of canonicalRows) {
		const keyDate = utcDay(row.startTime);
		const key = `${keyDate.toISOString()}::${row.sportFamily}`;
		const existing = dailyMap.get(key) ?? {
			date: keyDate,
			sportFamily: row.sportFamily,
			count: 0,
			distanceMetersSum: 0,
			durationSecondsSum: 0,
			avgHeartRateValues: [],
			maxHeartRateMax: 0
		};
		existing.count += 1;
		existing.distanceMetersSum += row.distanceMeters ? Number(row.distanceMeters) : 0;
		existing.durationSecondsSum += row.durationSeconds ? Number(row.durationSeconds) : 0;
		if (row.avgHeartRate) existing.avgHeartRateValues.push(Number(row.avgHeartRate));
		if (row.maxHeartRate) existing.maxHeartRateMax = Math.max(existing.maxHeartRateMax, Number(row.maxHeartRate));
		dailyMap.set(key, existing);
	}

	const dailyRows = Array.from(dailyMap.values()).map((agg) => {
		const avgHr = agg.avgHeartRateValues.length
			? agg.avgHeartRateValues.reduce((sum, v) => sum + v, 0) / agg.avgHeartRateValues.length
			: null;
		return {
			userId,
			date: agg.date,
			sportFamily: agg.sportFamily,
			count: agg.count,
			distanceMetersSum: String(agg.distanceMetersSum),
			durationSecondsSum: String(agg.durationSecondsSum),
			avgHeartRateAvg: avgHr === null ? null : String(avgHr),
			maxHeartRateMax: agg.maxHeartRateMax > 0 ? String(agg.maxHeartRateMax) : null,
			updatedAt: new Date()
		};
	});

	// neon-http driver does not support transactions; do ordered writes instead.
	await db.delete(canonicalWorkouts).where(
		and(
			eq(canonicalWorkouts.userId, userId),
			gte(canonicalWorkouts.startTime, startDate),
			lte(canonicalWorkouts.startTime, endDate)
		)
	);
	await db.delete(workoutDailyAggregates).where(
		and(
			eq(workoutDailyAggregates.userId, userId),
			gte(workoutDailyAggregates.date, utcDay(startDate)),
			lte(workoutDailyAggregates.date, utcDay(endDate))
		)
	);

	if (canonicalRows.length > 0) {
		await db.insert(canonicalWorkouts).values(canonicalRows);
	}
	if (dailyRows.length > 0) {
		await db.insert(workoutDailyAggregates).values(dailyRows);
	}

	console.log(
		`[workout-projections] refresh ${userId}: unified=${inRange.length}, canonical=${canonicalRows.length}, daily=${dailyRows.length}, ${(performance.now() - t0).toFixed(0)}ms`
	);

	return { canonicalCount: canonicalRows.length, dailyCount: dailyRows.length };
}
