import { db } from '$lib/db';
import { sensorAggregates, themes } from '$lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { findHealthThemeId } from '$lib/server/themes';
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
import { listDisturbances } from '$lib/server/sleep/disturbance-log';
import {
	groupDisturbancesByNight,
	mergeDisturbances,
	type MeasuredNight
} from '$lib/domain/sleep/disturbance';
import { sensorEvents } from '$lib/db/schema';
import { gte } from 'drizzle-orm';

const SLEEP_LOOKBACK_DAYS = 30;

/**
 * Søvn-undertemaets dashboard. Ingen ny datakilde: nattlengde, sleepLag og
 * sovepuls ligger allerede i sensor_aggregates, og netter/naps utledes av de
 * testede primitivene i $lib/domain/sleep-goals.
 */
export async function loadSleepDashboardData(userId: string) {
	const [weekly, monthly, nights, naps, goalRecords, metricSettings, disturbances, measuredNights] =
		await Promise.all([
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
		listSleepGoals(userId),
		// Tersklene bor på mortemaet — én kilde. Undertemaet har sin egen
		// (tomme) metric_settings-kolonne som bevisst ikke brukes.
		readParentMetricSettings(userId),
		listDisturbances(userId, { sinceDays: SLEEP_LOOKBACK_DAYS }),
		readMeasuredNights(userId, SLEEP_LOOKBACK_DAYS)
	]);

	const latestWeek = weekly[0] ?? null;
	const latestMetrics = (latestWeek?.metrics ?? null) as {
		sleep?: { avg?: number };
		sleepLag?: number;
		earlyWake?: number;
		sleepHeartRate?: { avg?: number };
		sleepDisturbances?: { nights?: number; awakeMinutes?: number | null };
	} | null;

	return {
		metricSettings,
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
		/**
		 * Urolige netter, gruppert per natt (nyeste først). Manuelle registreringer
		 * pluss Withings-målte netter der du ikke logget selv.
		 */
		disturbanceNights: groupDisturbancesByNight(mergeDisturbances(disturbances, measuredNights)),
		goals: goalRecords.map((record) => ({
			id: record.id,
			title: record.title,
			kind: record.goal.kind,
			evaluation: evaluateSleepGoal(record.goal, nights)
		})),
		latest: {
			avgHours: latestMetrics?.sleep?.avg ?? null,
			sleepLag: compositeSleepLag(latestMetrics),
			sleepHeartRate: latestMetrics?.sleepHeartRate?.avg ?? null,
			disturbedNights: latestMetrics?.sleepDisturbances?.nights ?? null,
			awakeMinutes: latestMetrics?.sleepDisturbances?.awakeMinutes ?? null
		}
	};
}

/**
 * Målte netter fra Withings, til forstyrrelses-utledningen.
 *
 * `sleep_latency` og `waso` måler nøyaktig det den manuelle loggeren spør om, og
 * har vært tilgjengelige fra Withings hele tiden — de ble bare aldri forespurt.
 * Manuell logging vinner der den finnes; disse fyller nettene man ikke logget.
 * Se `mergeDisturbances`.
 */
async function readMeasuredNights(userId: string, sinceDays: number): Promise<MeasuredNight[]> {
	const since = new Date(Date.now() - sinceDays * 86_400_000);
	const rows = await db.query.sensorEvents.findMany({
		columns: { timestamp: true, data: true },
		where: and(
			eq(sensorEvents.userId, userId),
			eq(sensorEvents.dataType, 'sleep'),
			gte(sensorEvents.timestamp, since)
		),
		orderBy: [desc(sensorEvents.timestamp)]
	});

	return rows.flatMap((row) => {
		const data = (row.data ?? {}) as Record<string, unknown>;
		const latency = typeof data.sleepLatency === 'number' ? data.sleepLatency : null;
		const waso = typeof data.waso === 'number' ? data.waso : null;
		// Rader fra før feltene ble forespurt har ingen av dem.
		if (latency === null && waso === null) return [];
		return [{ start: row.timestamp.toISOString(), sleepLatencySeconds: latency, wasoSeconds: waso }];
	});
}

/** Helse-mortemaets metric_settings, eller tomt objekt. */
async function readParentMetricSettings(userId: string): Promise<Record<string, unknown>> {
	const healthThemeId = await findHealthThemeId(userId);
	if (!healthThemeId) return {};
	const parent = await db.query.themes.findFirst({
		where: eq(themes.id, healthThemeId),
		columns: { metricSettings: true }
	});
	return (parent?.metricSettings ?? {}) as Record<string, unknown>;
}

export type SleepDashboardPayload = Awaited<ReturnType<typeof loadSleepDashboardData>>;
