import { db } from '$lib/db';
import { sensorAggregates } from '$lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { readHealthMetricSettings } from '$lib/server/health/metric-settings';
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
import { readNightlyPhysiology } from '$lib/server/health/nightly-physiology';
import {
	groupDisturbancesByNight,
	mergeDisturbances,
	nightKeyForTime,
	type MeasuredNight
} from '$lib/domain/sleep/disturbance';
import { pickHrvMetric, type HrvNight } from '$lib/domain/health/hrv';
import {
	buildSleepHeartRateNights,
	summarizeSleepHeartRate,
	type SleepHeartRateRow
} from '$lib/domain/health/sleep-heart-rate';
import { sensorEvents } from '$lib/db/schema';
import { gte } from 'drizzle-orm';

const SLEEP_LOOKBACK_DAYS = 30;

/**
 * Søvn-undertemaets dashboard. Ingen ny datakilde: nattlengde, sleepLag og
 * sovepuls ligger allerede i sensor_aggregates, og netter/naps utledes av de
 * testede primitivene i $lib/domain/sleep-goals.
 */
export async function loadSleepDashboardData(userId: string) {
	const [
		weekly,
		monthly,
		nights,
		naps,
		goalRecords,
		metricSettings,
		disturbances,
		measuredNights,
		physiology
	] = await Promise.all([
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
		readHealthMetricSettings(userId),
		listDisturbances(userId, { sinceDays: SLEEP_LOOKBACK_DAYS }),
		readMeasuredNights(userId, SLEEP_LOOKBACK_DAYS),
		readNightlyPhysiology(userId, SLEEP_LOOKBACK_DAYS)
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
		/**
		 * HRV: siste natt mot ditt eget snitt. Aldri absoluttverdien alene — SDNN
		 * varierer for mye mellom folk til at et tall uten baseline betyr noe.
		 */
		hrv: pickHrvMetric(physiology.hrvNights),
		/**
		 * Hvorfor HRV eventuelt mangler.
		 *
		 * Kortet skjulte seg helt når `hrv` var null, og da ser en usynkronisert måling
		 * ut som en funksjon som ikke finnes. HRV ligger bare i Withings'
		 * `action=get` per dato (`syncSleepHrv`), ikke i `getsummary` — så «søvn er
		 * synket» og «HRV er synket» er to ulike ting, og flaten må kunne skille dem.
		 */
		hrvAvailability: {
			sleepNights: physiology.sleepNights,
			nightsWithHrv: physiology.hrvNights.length
		},
		/**
		 * Sovepuls per natt. Hvilepulsen (`hr_min`) er hovedtallet — `hr_average`
		 * blander REM og oppvåkninger inn og ligger 5–10 slag høyere.
		 */
		sleepHeartRate: summarizeSleepHeartRate(
			buildSleepHeartRateNights(physiology.heartRateRows)
		),
		/** Pust og snorking siste natt som hadde tallene. */
		breathing: physiology.breathing,
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


export type SleepDashboardPayload = Awaited<ReturnType<typeof loadSleepDashboardData>>;
