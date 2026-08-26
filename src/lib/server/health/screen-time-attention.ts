/**
 * screen-time-attention.ts (server)
 *
 * Oppmerksomhetstid for ferdige perioder — samme beregning og samme
 * innstillinger som Skjermtid-flaten bruker.
 *
 * Finnes fordi `query_sensor_data` leser `sensor_aggregates`, som med vilje
 * bare inneholder iOS' RÅ tall (filtreringen gjøres ved lesing, se
 * `screentime-dashboard.ts`). Uten denne veien inn ville chatten svart 13t 24m
 * på en dag flaten viser som 7t 24m — og begge tallene ville sett riktige ut.
 */

import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, gte, lte } from 'drizzle-orm';
import { SCREEN_TIME_DATATYPE } from '$lib/server/integrations/screen-time';
import {
	categoryHourlyFromBuckets,
	hourlyArrayFromBuckets,
	toISODate
} from '$lib/utils/screen-time-series';
import {
	buildAttentionDays,
	buildWeekAttention,
	type AttentionDay,
	type ScreenTimeAttentionSettings,
	type ScreenTimeLevels,
	type WeekAttention
} from '$lib/domain/health/screen-time-attention';
import { readScreenTimeSettings } from './screen-time-settings';

export interface AttentionPeriodRequest {
	/** Nøkkel svaret slås opp på, f.eks. '2026W35'. */
	key: string;
	start: Date;
	end: Date;
	/** iOS' egne nivåtall for perioden, fra aggregatet. */
	levels: ScreenTimeLevels;
}

/**
 * Beregn oppmerksomhetstid for én eller flere perioder i ett kall.
 *
 * Dagene leses over hele spennet i én spørring, og attention beregnes på hele
 * lista samtidig — nattas rekke må kunne skjøtes over både midnatt og
 * periodeskiftet. Ett døgn ekstra i hver ende dekker kantene.
 *
 * Leser på **bruker + datatype**, ikke på sensor-id: en bruker uten den
 * forventede sensorraden ville ellers fått tomt svar som ser ut som «ingen
 * data». Samme regel som `listWaistMeasurements`, se CLAUDE.md.
 */
export async function attentionForPeriods(
	userId: string,
	periods: AttentionPeriodRequest[],
	settingsOverride?: ScreenTimeAttentionSettings
): Promise<Map<string, WeekAttention>> {
	const out = new Map<string, WeekAttention>();
	if (periods.length === 0) return out;

	const settings = settingsOverride ?? (await readScreenTimeSettings(userId));

	const earliest = new Date(Math.min(...periods.map((p) => p.start.getTime())) - 86400000);
	const latest = new Date(Math.max(...periods.map((p) => p.end.getTime())) + 86400000);

	const rows = await db.query.sensorEvents.findMany({
		where: and(
			eq(sensorEvents.userId, userId),
			eq(sensorEvents.dataType, SCREEN_TIME_DATATYPE),
			gte(sensorEvents.timestamp, earliest),
			lte(sensorEvents.timestamp, latest)
		),
		orderBy: [sensorEvents.timestamp]
	});

	const days = buildAttentionDays(
		rows.map((e) => {
			const d = (e.data ?? {}) as Record<string, any>;
			return {
				dateISO: toISODate(e.timestamp),
				totalMinutes: typeof d.totalMinutes === 'number' ? d.totalMinutes : 0,
				socialMinutes: typeof d.categories?.social === 'number' ? d.categories.social : 0,
				hourly: hourlyArrayFromBuckets(d.hourly),
				socialHourly: categoryHourlyFromBuckets(d.hourly, 'social'),
				apps: d.apps as Record<string, number> | undefined
			};
		}),
		settings
	);

	// Dato → dag, og dato → tidspunktet raden faktisk har (for periodegrensene).
	const stamps = new Map<string, Date>();
	for (const e of rows) stamps.set(toISODate(e.timestamp), e.timestamp);

	for (const period of periods) {
		const inPeriod: AttentionDay[] = days.filter((d) => {
			const ts = stamps.get(d.dateISO);
			return ts ? ts >= period.start && ts <= period.end : false;
		});
		out.set(period.key, buildWeekAttention(period.levels, inPeriod, settings));
	}
	return out;
}

/** Nivåfeltene fra en `metrics.screenTime`-blokk, med trygge standardverdier. */
export function levelsFromScreenTimeMetric(metric: unknown): ScreenTimeLevels | null {
	if (!metric || typeof metric !== 'object') return null;
	const m = metric as Record<string, unknown>;
	const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
	return {
		totalMinutes: num(m.totalMinutes),
		avgPerDayMinutes: num(m.avgPerDayMinutes),
		socialMinutes: num(m.socialMinutes),
		socialAvgPerDayMinutes: num(m.socialAvgPerDayMinutes)
	};
}
