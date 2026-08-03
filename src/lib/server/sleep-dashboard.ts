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
	nightKeyForTime,
	type MeasuredNight
} from '$lib/domain/sleep/disturbance';
import { pickHrvMetric, type HrvNight } from '$lib/domain/health/hrv';
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
		readParentMetricSettings(userId),
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

/**
 * HRV per natt, og siste nattens pust/snorking, fra søvnhendelsene.
 *
 * Nattnøkkelen er **datoen du våkner** (`nightKeyForTime`), samme konvensjon som
 * `buildSleepNightSeries` og forstyrrelsesloggen. Uten det ville HRV-nettene ligget
 * en dag forskjøvet fra nattlengdene de skal sammenlignes med.
 */
async function readNightlyPhysiology(
	userId: string,
	sinceDays: number
): Promise<{
	hrvNights: HrvNight[];
	breathing: {
		date: string;
		apneaHypopneaIndex: number | null;
		snoringMinutes: number | null;
		snoringEpisodes: number | null;
	} | null;
}> {
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

	const hrvNights: HrvNight[] = [];
	let breathing: Awaited<ReturnType<typeof readNightlyPhysiology>>['breathing'] = null;

	for (const row of rows) {
		const data = (row.data ?? {}) as Record<string, unknown>;
		const date = nightKeyForTime(row.timestamp);
		if (!date) continue;

		const hrv = data.hrv as { sdnnMs?: unknown; samples?: unknown } | null | undefined;
		if (hrv && typeof hrv.sdnnMs === 'number') {
			hrvNights.push({
				date,
				sdnnMs: hrv.sdnnMs,
				samples: typeof hrv.samples === 'number' ? hrv.samples : 0
			});
		}

		// Radene er nyeste først, så den første med tall er siste natt som har dem.
		const ahi = typeof data.apneaHypopneaIndex === 'number' ? data.apneaHypopneaIndex : null;
		const snoringSeconds = typeof data.snoringSeconds === 'number' ? data.snoringSeconds : null;
		const episodes = typeof data.snoringEpisodes === 'number' ? data.snoringEpisodes : null;
		if (!breathing && (ahi !== null || snoringSeconds !== null)) {
			breathing = {
				date,
				apneaHypopneaIndex: ahi,
				snoringMinutes: snoringSeconds === null ? null : Math.round(snoringSeconds / 60),
				snoringEpisodes: episodes
			};
		}
	}

	return { hrvNights, breathing };
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
