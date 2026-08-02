import { db } from '$lib/db';
import { sensorAggregates } from '$lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import {
	listSleepGoals,
	listRecentNaps,
	readSleepNights
} from '$lib/server/integrations/sleep-goals';
import { evaluateSleepGoal } from '$lib/domain/sleep-goals';
import {
	buildSleepNightSeries,
	summarizeSleepRhythm,
	compositeSleepLag
} from '$lib/domain/health/sleep-overview';

const SLEEP_LOOKBACK_DAYS = 30;

/**
 * Søvn-undertemaets dashboard. Ingen ny datakilde: nattlengde, sleepLag og
 * sovepuls ligger allerede i sensor_aggregates, og netter/naps utledes av de
 * testede primitivene i $lib/domain/sleep-goals.
 */
export async function loadSleepDashboardData(userId: string) {
	const [weekly, monthly, nights, naps, goalRecords] = await Promise.all([
		db.query.sensorAggregates.findMany({
			where: and(eq(sensorAggregates.userId, userId), eq(sensorAggregates.period, 'week')),
			orderBy: [desc(sensorAggregates.startDate)],
			limit: 26
		}),
		db.query.sensorAggregates.findMany({
			where: and(eq(sensorAggregates.userId, userId), eq(sensorAggregates.period, 'month')),
			orderBy: [desc(sensorAggregates.startDate)],
			limit: 24
		}),
		readSleepNights(userId, SLEEP_LOOKBACK_DAYS),
		listRecentNaps(userId, SLEEP_LOOKBACK_DAYS),
		listSleepGoals(userId)
	]);

	const latestWeek = weekly[0] ?? null;
	const latestMetrics = (latestWeek?.metrics ?? null) as {
		sleep?: { avg?: number };
		sleepLag?: number;
		earlyWake?: number;
		sleepHeartRate?: { avg?: number };
	} | null;

	return {
		// Eldste først, som resten av dashboardene bruker for tidsserier.
		weekly: weekly.slice().reverse(),
		monthly: monthly.slice().reverse(),
		nights: buildSleepNightSeries(nights),
		rhythm: summarizeSleepRhythm(nights),
		naps: naps.map((nap) => ({
			id: nap.id,
			start: nap.start.toISOString(),
			durationMinutes: nap.durationMinutes,
			manual: nap.manual,
			note: nap.note ?? null
		})),
		goals: goalRecords.map((record) => ({
			id: record.id,
			title: record.title,
			kind: record.goal.kind,
			evaluation: evaluateSleepGoal(record.goal, nights)
		})),
		latest: {
			avgHours: latestMetrics?.sleep?.avg ?? null,
			sleepLag: compositeSleepLag(latestMetrics),
			sleepHeartRate: latestMetrics?.sleepHeartRate?.avg ?? null
		}
	};
}

export type SleepDashboardPayload = Awaited<ReturnType<typeof loadSleepDashboardData>>;
