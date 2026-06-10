import { db, sql as rawSql } from '$lib/db';
import { sensorEvents, sensorAggregates, metricAggregateCache, canonicalWorkouts } from '$lib/db/schema';
import { eq, and, gte, lte, sql, desc } from 'drizzle-orm';
import { getAllMetrics } from '$lib/server/services/metric-definition-service';
import { generateWeeks, generateMonths, generateYears, generateDays, getCurrentWeek, getCurrentMonth, getCurrentYear, getWeeksSince, getMonthsSince, getYearsSince } from './time-periods';
import type { WeekPeriod, MonthPeriod, YearPeriod, DayPeriod } from './time-periods';
import { classifyEffortFamily, type EffortFamily } from '$lib/server/services/effort-service';
import { computeSleepLag } from '$lib/server/services/sleep-lag';

type WeeklyEffortMetric = NonNullable<NonNullable<typeof sensorAggregates.$inferSelect.metrics>['weeklyEffort']>;

/**
 * Calculate average, excluding nulls
 */
export function avg(values: (number | undefined)[]): number | undefined {
	const valid = values.filter((v): v is number => v !== undefined && v !== null);
	if (valid.length === 0) return undefined;
	return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

/**
 * Calculate sum, excluding nulls
 */
export function sum(values: (number | undefined)[]): number | undefined {
	const valid = values.filter((v): v is number => v !== undefined && v !== null);
	if (valid.length === 0) return undefined;
	return valid.reduce((sum, v) => sum + v, 0);
}

/**
 * Calculate min
 */
export function min(values: (number | undefined)[]): number | undefined {
	const valid = values.filter((v): v is number => v !== undefined && v !== null);
	if (valid.length === 0) return undefined;
	return Math.min(...valid);
}

/**
 * Calculate max
 */
export function max(values: (number | undefined)[]): number | undefined {
	const valid = values.filter((v): v is number => v !== undefined && v !== null);
	if (valid.length === 0) return undefined;
	return Math.max(...valid);
}

/**
 * Get latest non-null value
 */
export function latest(values: (number | undefined)[]): number | undefined {
	for (let i = values.length - 1; i >= 0; i--) {
		if (values[i] !== undefined && values[i] !== null) {
			return values[i];
		}
	}
	return undefined;
}

/**
 * Snitt av nattlig sleep_lag-indeks for søvn-events i perioden.
 * Per-natt-verdien lagres på sensor_events.data.sleepLag ved import (Withings).
 * Faller tilbake til å beregne fra timestamp + metadata.enddate for eldre events.
 */
function calculateSleepLag(events: any[]): number | undefined {
	const values: number[] = [];
	for (const e of events) {
		if (e.dataType !== 'sleep') continue;
		if (typeof e.data?.sleepLag === 'number') {
			values.push(e.data.sleepLag);
			continue;
		}
		const endSec = e.metadata?.enddate;
		const start = e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp);
		if (typeof endSec === 'number') {
			const v = computeSleepLag(start, new Date(endSec * 1000));
			if (v !== undefined) values.push(v);
		}
	}
	if (values.length === 0) return undefined;
	return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

/**
 * Calculate early wake metric
 * Your logic: % of time asleep between 06:00 and 08:00
 */
function calculateEarlyWake(events: any[]): number | undefined {
	// TODO: Implement your specific early wake calculation
	return undefined;
}

/**
 * Skjermtid-aggregat for en periode. Leser `screen_time`-dagsevents (totaler +
 * evt. kategorier/time-for-time) og — for ukesperioder — den autoritative
 * `screen_time_week`-oppsummeringen når den finnes.
 *
 * Datene er allerede normalisert ved skriving (kanoniske kategorinøkler, minutter),
 * så denne fila importerer bevisst ingenting fra screen-time-modulene (unngår
 * sirkulær import: screen-time.ts → aggregation.ts).
 */
function computeScreenTimeMetrics(events: any[], useWeekEvent: boolean): Record<string, unknown> | null {
	const days = events.filter((e) => e.dataType === 'screen_time');
	const weekEvent = useWeekEvent ? events.find((e) => e.dataType === 'screen_time_week') : undefined;
	if (days.length === 0 && !weekEvent) return null;

	const byCategory: Record<string, number> = {};
	const byHour: number[] = new Array(24).fill(0);
	const socialByHour: number[] = new Array(24).fill(0);
	let totalFromDays = 0;
	let maxDayMinutes = 0;
	let socialFromDays = 0;
	let dayCount = 0;
	let hourlyDayCount = 0;

	for (const e of days) {
		const d = (e.data ?? {}) as Record<string, any>;
		const t = typeof d.totalMinutes === 'number' ? d.totalMinutes : 0;
		if (t > 0) {
			totalFromDays += t;
			maxDayMinutes = Math.max(maxDayMinutes, t);
			dayCount += 1;
		}
		const cats = d.categories as Record<string, number> | undefined;
		if (cats) {
			for (const [k, v] of Object.entries(cats)) {
				if (typeof v === 'number' && Number.isFinite(v)) byCategory[k] = (byCategory[k] ?? 0) + v;
			}
			if (typeof cats.social === 'number') socialFromDays += cats.social;
		}
		const hourly = Array.isArray(d.hourly) ? d.hourly : null;
		if (hourly && hourly.length > 0) {
			hourlyDayCount += 1;
			for (const bucket of hourly) {
				const h = typeof bucket?.hour === 'number' ? bucket.hour : -1;
				if (h < 0 || h > 23) continue;
				byHour[h] += typeof bucket.totalMinutes === 'number' ? bucket.totalMinutes : 0;
				const social = bucket?.categories?.social;
				if (typeof social === 'number') socialByHour[h] += social;
			}
		}
	}

	// Ukesoppsummeringen er autoritativ for ukestotal + kategorisplitt når den finnes.
	let weekCategories: Record<string, number> | null = null;
	let weekTotal: number | null = null;
	if (weekEvent) {
		const wd = (weekEvent.data ?? {}) as Record<string, any>;
		if (typeof wd.weekTotalMinutes === 'number' && wd.weekTotalMinutes > 0) weekTotal = wd.weekTotalMinutes;
		if (wd.categories && typeof wd.categories === 'object') weekCategories = wd.categories as Record<string, number>;
	}

	const effectiveCategories =
		weekCategories && Object.keys(weekCategories).length > 0 ? weekCategories : byCategory;
	const totalMinutes = weekTotal ?? totalFromDays;
	const socialMinutes =
		typeof effectiveCategories.social === 'number' ? effectiveCategories.social : socialFromDays;
	const denomDays = weekEvent && weekTotal ? 7 : Math.max(1, dayCount);

	return {
		totalMinutes: Math.round(totalMinutes),
		avgPerDayMinutes: Math.round(totalMinutes / denomDays),
		maxDayMinutes: Math.round(maxDayMinutes),
		socialMinutes: Math.round(socialMinutes),
		socialAvgPerDayMinutes: Math.round(socialMinutes / denomDays),
		byCategory: effectiveCategories,
		byHour,
		socialByHour,
		dayCount,
		hourlyDayCount
	};
}

/**
 * Hent kanoniske økter for et tidsvindu og bucket effort per family og per dag.
 * Returnerer null hvis ingen økter telles (varighet for kort, ingen effort).
 */
async function computeWeeklyEffort(
	userId: string,
	weekStart: Date,
	weekEnd: Date
): Promise<WeeklyEffortMetric | null> {
	const rows = await db.query.canonicalWorkouts.findMany({
		where: and(
			eq(canonicalWorkouts.userId, userId),
			gte(canonicalWorkouts.startTime, weekStart),
			lte(canonicalWorkouts.startTime, weekEnd)
		)
	});

	if (rows.length === 0) return null;

	const byFamily: Partial<Record<EffortFamily, number>> = {};
	const byDay = [0, 0, 0, 0, 0, 0, 0]; // Mon..Sun (Oslo lokaltid)
	let total = 0;
	let trimpSum = 0;
	let workoutCount = 0;

	for (const row of rows) {
		const score = row.effortScore !== null && row.effortScore !== undefined ? Number(row.effortScore) : null;
		if (score === null || !Number.isFinite(score) || score <= 0) continue;

		const family = classifyEffortFamily(row.sportType, row.sportFamily);
		byFamily[family] = (byFamily[family] ?? 0) + score;
		total += score;
		workoutCount += 1;
		if (row.effortMethod === 'trimp') trimpSum += score;

		const dayIndex = isoWeekdayIndex(row.startTime);
		byDay[dayIndex] += score;
	}

	if (workoutCount === 0) return null;

	const roundedByFamily: WeeklyEffortMetric['byFamily'] = {};
	for (const [family, value] of Object.entries(byFamily)) {
		roundedByFamily[family as EffortFamily] = Math.round((value as number) * 10) / 10;
	}

	return {
		total: Math.round(total * 10) / 10,
		byFamily: roundedByFamily,
		byDay: byDay.map((v) => Math.round(v * 10) / 10),
		hrCoveragePct: total > 0 ? Math.round((trimpSum / total) * 100) : 0,
		workoutCount
	};
}

/** Hent total weekly effort for de 4 ukene umiddelbart før gitt dato fra allerede lagrede aggregater. */
async function fetchPriorWeeklyEffortTotals(userId: string, beforeStart: Date): Promise<number[]> {
	const rows = await db.query.sensorAggregates.findMany({
		where: and(
			eq(sensorAggregates.userId, userId),
			eq(sensorAggregates.period, 'week'),
			lte(sensorAggregates.startDate, new Date(beforeStart.getTime() - 1))
		),
		orderBy: [desc(sensorAggregates.startDate)],
		limit: 4
	});
	return rows
		.map((row) => (row.metrics as { weeklyEffort?: { total?: number } } | null)?.weeklyEffort?.total)
		.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

/** ISO weekday → 0=Mon..6=Sun. Bruker Europe/Oslo for å treffe brukerens uke. */
function isoWeekdayIndex(date: Date): number {
	// JS getDay(): 0=Sun..6=Sat. Konverter til 0=Mon..6=Sun.
	const oslo = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Oslo' }));
	const jsDay = oslo.getDay();
	return (jsDay + 6) % 7;
}

/**
 * Aggregate weekly data for a user
 */
export async function aggregateWeeklyData(userId: string, weeks?: WeekPeriod[]) {
	const periodsToAggregate = weeks || generateWeeks();
	
	// When specific periods are given, only fetch events within that range
	const rangeStart = periodsToAggregate[periodsToAggregate.length - 1]?.startTime;
	const rangeEnd = periodsToAggregate[0]?.endTime;
	const allEvents = await db.query.sensorEvents.findMany({
		where: rangeStart && rangeEnd
			? and(eq(sensorEvents.userId, userId), gte(sensorEvents.timestamp, rangeStart), lte(sensorEvents.timestamp, rangeEnd))
			: eq(sensorEvents.userId, userId),
		orderBy: [sensorEvents.timestamp]
	});
	
	console.log(`   Processing ${periodsToAggregate.length} weeks with ${allEvents.length} total events...`);

	const rows: typeof sensorAggregates.$inferInsert[] = [];

	for (const week of periodsToAggregate) {
		const events = allEvents.filter(e =>
			e.timestamp >= week.startTime && e.timestamp <= week.endTime
		);

		if (events.length === 0) continue;

		const weights = events.map((e) => e.data?.weight).filter((v): v is number => v !== undefined);
		const steps = events.map((e) => e.data?.steps).filter((v): v is number => v !== undefined);
		const sleepDurations = events.map((e) => e.data?.sleepDuration).filter((v): v is number => v !== undefined);
		const calories = events.map((e) => e.data?.calories).filter((v): v is number => v !== undefined);
		const distances = events.map((e) => e.data?.distance).filter((v): v is number => v !== undefined);
		const heartRates = events.map((e) => e.data?.hr_average).filter((v): v is number => v !== undefined);
		const activityEvents = events.filter(e => e.eventType === 'activity');
		const intenseMinutes = activityEvents
			.map((e) => ((e.data?.intense || 0) + (e.data?.moderate || 0)) / 60)
			.filter((v) => v > 0);
		const workoutEvents = events.filter(e => e.dataType === 'workout');
		const runningEvents = workoutEvents.filter(e =>
			((e.data?.sportType as string | undefined) ?? '').toLowerCase().includes('run')
		);
		const runningKm = runningEvents.reduce((s, e) => s + ((e.data?.distance as number | undefined) ?? 0), 0) / 1000;
		const sleepHeartRates = events
			.filter(e => e.dataType === 'sleep')
			.map(e => e.data?.hr_average)
			.filter((v): v is number => v !== undefined);

		const metrics: any = {};

		if (weights.length > 0) metrics.weight = { avg: avg(weights), min: min(weights), max: max(weights), latest: latest(weights), change: weights.length > 1 ? (latest(weights)! - weights[0]) : 0, values: weights };
		if (steps.length > 0) metrics.steps = { sum: sum(steps), avg: avg(steps), max: max(steps), values: steps };
		if (sleepDurations.length > 0) { const h = sleepDurations.map(s => s / 3600); metrics.sleep = { avg: avg(h), min: min(h), max: max(h) }; }
		if (calories.length > 0) metrics.calories = { sum: sum(calories), avg: avg(calories) };
		if (distances.length > 0) metrics.distance = { sum: sum(distances), avg: avg(distances) };
		if (intenseMinutes.length > 0) metrics.intenseMinutes = { sum: sum(intenseMinutes), avg: avg(intenseMinutes) };
		if (heartRates.length > 0) metrics.heartRate = { avg: avg(heartRates), min: min(heartRates), max: max(heartRates), values: heartRates };
		if (sleepHeartRates.length > 0) metrics.sleepHeartRate = { avg: avg(sleepHeartRates), min: min(sleepHeartRates), max: max(sleepHeartRates) };
		if (workoutEvents.length > 0) metrics.workouts = { count: workoutEvents.length, types: { running: runningKm } };

		const screenTime = computeScreenTimeMetrics(events, true);
		if (screenTime) metrics.screenTime = screenTime;

		const weeklyEffort = await computeWeeklyEffort(userId, week.startTime, week.endTime);
		if (weeklyEffort) {
			const priorTotals = await fetchPriorWeeklyEffortTotals(userId, week.startTime);
			if (priorTotals.length > 0) {
				const p4wAvg = priorTotals.reduce((sum, value) => sum + value, 0) / priorTotals.length;
				weeklyEffort.baseline = {
					p4wAvg: Math.round(p4wAvg * 10) / 10,
					delta: Math.round((weeklyEffort.total - p4wAvg) * 10) / 10
				};
			}
			metrics.weeklyEffort = weeklyEffort;
		}

		const sleepLag = calculateSleepLag(events);
		if (sleepLag !== undefined) metrics.sleepLag = sleepLag;
		const earlyWake = calculateEarlyWake(events);
		if (earlyWake !== undefined) metrics.earlyWake = earlyWake;

		rows.push({ userId, period: 'week', periodKey: week.yearweek, year: week.year, startDate: week.startTime, endDate: week.endTime, metrics, eventCount: events.length });
	}

	if (rows.length > 0) {
		await db.insert(sensorAggregates).values(rows).onConflictDoUpdate({
			target: [sensorAggregates.userId, sensorAggregates.period, sensorAggregates.periodKey],
			// startDate/endDate oppdateres også: eldre rader kan ha tidssoneskjeve datoer
			// (lokal midnatt skrevet via toISOString), og skal heles ved re-aggregering.
			set: {
				metrics: sql`excluded.metrics`,
				eventCount: sql`excluded.event_count`,
				startDate: sql`excluded.start_date`,
				endDate: sql`excluded.end_date`,
				updatedAt: new Date()
			}
		});
	}
}

/**
 * Aggregate monthly data for a user
 */
export async function aggregateMonthlyData(userId: string, months?: MonthPeriod[]) {
	const periodsToAggregate = months || generateMonths();
	
	// When specific periods are given, only fetch events within that range
	const rangeStart = periodsToAggregate[periodsToAggregate.length - 1]?.startTime;
	const rangeEnd = periodsToAggregate[0]?.endTime;
	const allEvents = await db.query.sensorEvents.findMany({
		where: rangeStart && rangeEnd
			? and(eq(sensorEvents.userId, userId), gte(sensorEvents.timestamp, rangeStart), lte(sensorEvents.timestamp, rangeEnd))
			: eq(sensorEvents.userId, userId),
		orderBy: [sensorEvents.timestamp]
	});
	
	console.log(`      Processing ${periodsToAggregate.length} months with ${allEvents.length} total events...`);

	const rows: typeof sensorAggregates.$inferInsert[] = [];

	for (const month of periodsToAggregate) {
		const events = allEvents.filter(e =>
			e.timestamp >= month.startTime && e.timestamp <= month.endTime
		);

		if (events.length === 0) continue;

		const weights = events.map((e) => e.data?.weight).filter((v): v is number => v !== undefined);
		const steps = events.map((e) => e.data?.steps).filter((v): v is number => v !== undefined);
		const sleepDurations = events.map((e) => e.data?.sleepDuration).filter((v): v is number => v !== undefined);
		const calories = events.map((e) => e.data?.calories).filter((v): v is number => v !== undefined);
		const distances = events.map((e) => e.data?.distance).filter((v): v is number => v !== undefined);
		const heartRates = events.map((e) => e.data?.hr_average).filter((v): v is number => v !== undefined);
		const activityEvents = events.filter(e => e.eventType === 'activity');
		const intenseMinutes = activityEvents
			.map((e) => ((e.data?.intense || 0) + (e.data?.moderate || 0)) / 60)
			.filter((v) => v > 0);
		const workoutEvents = events.filter(e => e.dataType === 'workout');
		const runningEvents = workoutEvents.filter(e =>
			((e.data?.sportType as string | undefined) ?? '').toLowerCase().includes('run')
		);
		const runningKm = runningEvents.reduce((s, e) => s + ((e.data?.distance as number | undefined) ?? 0), 0) / 1000;
		const sleepHeartRates = events
			.filter(e => e.dataType === 'sleep')
			.map(e => e.data?.hr_average)
			.filter((v): v is number => v !== undefined);

		const metrics: any = {};

		if (weights.length > 0) metrics.weight = { avg: avg(weights), min: min(weights), max: max(weights), latest: latest(weights), change: weights.length > 1 ? (latest(weights)! - weights[0]) : 0 };
		if (steps.length > 0) metrics.steps = { sum: sum(steps), avg: avg(steps), max: max(steps) };
		if (sleepDurations.length > 0) { const h = sleepDurations.map(s => s / 3600); metrics.sleep = { avg: avg(h), min: min(h), max: max(h) }; }
		if (calories.length > 0) metrics.calories = { sum: sum(calories), avg: avg(calories) };
		if (distances.length > 0) metrics.distance = { sum: sum(distances), avg: avg(distances) };
		if (intenseMinutes.length > 0) metrics.intenseMinutes = { sum: sum(intenseMinutes), avg: avg(intenseMinutes) };
		if (heartRates.length > 0) metrics.heartRate = { avg: avg(heartRates), min: min(heartRates), max: max(heartRates) };
		if (sleepHeartRates.length > 0) metrics.sleepHeartRate = { avg: avg(sleepHeartRates), min: min(sleepHeartRates), max: max(sleepHeartRates) };
		if (workoutEvents.length > 0) metrics.workouts = { count: workoutEvents.length, types: { running: runningKm } };

		const screenTime = computeScreenTimeMetrics(events, false);
		if (screenTime) metrics.screenTime = screenTime;

		const sleepLag = calculateSleepLag(events);
		if (sleepLag !== undefined) metrics.sleepLag = sleepLag;

		rows.push({ userId, period: 'month', periodKey: month.yearmonth, year: month.year, startDate: month.startTime, endDate: month.endTime, metrics, eventCount: events.length });
	}

	if (rows.length > 0) {
		await db.insert(sensorAggregates).values(rows).onConflictDoUpdate({
			target: [sensorAggregates.userId, sensorAggregates.period, sensorAggregates.periodKey],
			// startDate/endDate oppdateres også: eldre rader kan ha tidssoneskjeve datoer
			// (lokal midnatt skrevet via toISOString), og skal heles ved re-aggregering.
			set: {
				metrics: sql`excluded.metrics`,
				eventCount: sql`excluded.event_count`,
				startDate: sql`excluded.start_date`,
				endDate: sql`excluded.end_date`,
				updatedAt: new Date()
			}
		});
	}
}

/**
 * Aggregate yearly data
 */
export async function aggregateYearlyData(userId: string, years?: YearPeriod[]) {
	const periodsToAggregate = years || generateYears();
	
	// When specific periods are given, only fetch events within that range
	const rangeStart = periodsToAggregate[periodsToAggregate.length - 1]?.startTime;
	const rangeEnd = periodsToAggregate[0]?.endTime;
	const allEvents = await db.query.sensorEvents.findMany({
		where: rangeStart && rangeEnd
			? and(eq(sensorEvents.userId, userId), gte(sensorEvents.timestamp, rangeStart), lte(sensorEvents.timestamp, rangeEnd))
			: eq(sensorEvents.userId, userId),
		orderBy: [sensorEvents.timestamp]
	});
	
	console.log(`         Processing ${periodsToAggregate.length} years with ${allEvents.length} total events...`);

	const rows: typeof sensorAggregates.$inferInsert[] = [];

	for (const year of periodsToAggregate) {
		const events = allEvents.filter(e =>
			e.timestamp >= year.startTime && e.timestamp <= year.endTime
		);

		if (events.length === 0) continue;

		const weights = events.map((e) => e.data?.weight).filter((v): v is number => v !== undefined);
		const steps = events.map((e) => e.data?.steps).filter((v): v is number => v !== undefined);
		const sleepDurations = events.map((e) => e.data?.sleepDuration).filter((v): v is number => v !== undefined);
		const calories = events.map((e) => e.data?.calories).filter((v): v is number => v !== undefined);
		const distances = events.map((e) => e.data?.distance).filter((v): v is number => v !== undefined);
		const heartRates = events.map((e) => e.data?.hr_average).filter((v): v is number => v !== undefined);
		const activityEvents = events.filter(e => e.eventType === 'activity');
		const intenseMinutes = activityEvents
			.map((e) => ((e.data?.intense || 0) + (e.data?.moderate || 0)) / 60)
			.filter((v) => v > 0);
		const workoutEvents = events.filter(e => e.dataType === 'workout');
		const runningEvents = workoutEvents.filter(e =>
			((e.data?.sportType as string | undefined) ?? '').toLowerCase().includes('run')
		);
		const runningKm = runningEvents.reduce((s, e) => s + ((e.data?.distance as number | undefined) ?? 0), 0) / 1000;
		const sleepHeartRates = events
			.filter(e => e.dataType === 'sleep')
			.map(e => e.data?.hr_average)
			.filter((v): v is number => v !== undefined);

		const metrics: any = {};

		if (weights.length > 0) metrics.weight = { avg: avg(weights), min: min(weights), max: max(weights), latest: latest(weights), change: weights.length > 1 ? (latest(weights)! - weights[0]) : 0 };
		if (steps.length > 0) metrics.steps = { sum: sum(steps), avg: avg(steps), max: max(steps) };
		if (sleepDurations.length > 0) { const h = sleepDurations.map(s => s / 3600); metrics.sleep = { avg: avg(h), min: min(h), max: max(h) }; }
		if (calories.length > 0) metrics.calories = { sum: sum(calories), avg: avg(calories) };
		if (distances.length > 0) metrics.distance = { sum: sum(distances), avg: avg(distances) };
		if (intenseMinutes.length > 0) metrics.intenseMinutes = { sum: sum(intenseMinutes), avg: avg(intenseMinutes) };
		if (heartRates.length > 0) metrics.heartRate = { avg: avg(heartRates), min: min(heartRates), max: max(heartRates) };
		if (sleepHeartRates.length > 0) metrics.sleepHeartRate = { avg: avg(sleepHeartRates), min: min(sleepHeartRates), max: max(sleepHeartRates) };
		if (workoutEvents.length > 0) metrics.workouts = { count: workoutEvents.length, types: { running: runningKm } };

		rows.push({ userId, period: 'year', periodKey: year.year.toString(), year: year.year, startDate: year.startTime, endDate: year.endTime, metrics, eventCount: events.length });
	}

	if (rows.length > 0) {
		await db.insert(sensorAggregates).values(rows).onConflictDoUpdate({
			target: [sensorAggregates.userId, sensorAggregates.period, sensorAggregates.periodKey],
			// startDate/endDate oppdateres også: eldre rader kan ha tidssoneskjeve datoer
			// (lokal midnatt skrevet via toISOString), og skal heles ved re-aggregering.
			set: {
				metrics: sql`excluded.metrics`,
				eventCount: sql`excluded.event_count`,
				startDate: sql`excluded.start_date`,
				endDate: sql`excluded.end_date`,
				updatedAt: new Date()
			}
		});
	}
}

/**
 * Aggregate daily effort totals (kanoniske workouts pr. UTC-kalenderdag).
 * Lagrer en rad i sensor_aggregates med period='day', periodKey='YYYY-MM-DD'.
 * Brukes som input til CTL/ATL/TSB-modellen klient-side.
 */
export async function aggregateDailyEffort(userId: string, days?: DayPeriod[]) {
	const periodsToAggregate = days || generateDays();
	if (periodsToAggregate.length === 0) return;

	const rangeStart = periodsToAggregate[periodsToAggregate.length - 1].startTime;
	const rangeEnd = periodsToAggregate[0].endTime;

	const workouts = await db.query.canonicalWorkouts.findMany({
		where: and(
			eq(canonicalWorkouts.userId, userId),
			gte(canonicalWorkouts.startTime, rangeStart),
			lte(canonicalWorkouts.startTime, rangeEnd)
		)
	});

	const byDay = new Map<string, { total: number; trimp: number; count: number }>();
	for (const w of workouts) {
		const score = w.effortScore !== null && w.effortScore !== undefined ? Number(w.effortScore) : null;
		if (score === null || !Number.isFinite(score) || score <= 0) continue;
		const key = w.startTime.toISOString().split('T')[0];
		const entry = byDay.get(key) ?? { total: 0, trimp: 0, count: 0 };
		entry.total += score;
		if (w.effortMethod === 'trimp') entry.trimp += score;
		entry.count += 1;
		byDay.set(key, entry);
	}

	const rows: typeof sensorAggregates.$inferInsert[] = [];
	for (const day of periodsToAggregate) {
		const entry = byDay.get(day.periodKey);
		if (!entry) continue;
		const total = Math.round(entry.total * 10) / 10;
		const hrCoveragePct = total > 0 ? Math.round((entry.trimp / total) * 100) : 0;
		rows.push({
			userId,
			period: 'day',
			periodKey: day.periodKey,
			year: day.year,
			startDate: day.startTime,
			endDate: day.endTime,
			metrics: {
				dailyEffort: {
					total,
					workoutCount: entry.count,
					hrCoveragePct
				}
			},
			eventCount: entry.count
		});
	}

	if (rows.length > 0) {
		await db.insert(sensorAggregates).values(rows).onConflictDoUpdate({
			target: [sensorAggregates.userId, sensorAggregates.period, sensorAggregates.periodKey],
			// startDate/endDate oppdateres også: eldre rader kan ha tidssoneskjeve datoer
			// (lokal midnatt skrevet via toISOString), og skal heles ved re-aggregering.
			set: {
				metrics: sql`excluded.metrics`,
				eventCount: sql`excluded.event_count`,
				startDate: sql`excluded.start_date`,
				endDate: sql`excluded.end_date`,
				updatedAt: new Date()
			}
		});
	}
}

/**
 * Aggregate all periods that overlap with [fromDate, now] — for incremental imports spanning multiple weeks/months
 */
export async function aggregatePeriodsFrom(userId: string, fromDate: Date) {
	const startTime = Date.now();

	const weeks = getWeeksSince(fromDate);
	const months = getMonthsSince(fromDate);
	const years = getYearsSince(fromDate);

	console.log(`📊 Aggregating ${weeks.length} weeks, ${months.length} months, ${years.length} years from ${fromDate.toISOString().split('T')[0]}...`);
	await aggregateWeeklyData(userId, weeks);
	await aggregateMonthlyData(userId, months);
	await aggregateYearlyData(userId, years);
	const daysSince = Math.max(1, Math.ceil((Date.now() - fromDate.getTime()) / 86400000) + 1);
	await aggregateDailyEffort(userId, generateDays(daysSince));

	console.log(`✅ Period aggregation completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
}

/**
 * Aggregate only current week, month, and year for a user (fast, for incremental syncs)
 */
export async function aggregateCurrentPeriods(userId: string) {
	const startTime = Date.now();

	console.log('📊 Aggregating current period data...');
	await aggregateWeeklyData(userId, [getCurrentWeek()]);
	await aggregateMonthlyData(userId, [getCurrentMonth()]);
	await aggregateYearlyData(userId, [getCurrentYear()]);
	await aggregateDailyEffort(userId, generateDays(60));

	console.log(`✅ Current period aggregation completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
}

/**
 * Aggregate all periods for a user
 */
export async function aggregateAllPeriods(userId: string) {
	const startTime = Date.now();
	
	console.log('� Aggregating weekly data...');
	await aggregateWeeklyData(userId);
	console.log(`   ✓ Weekly aggregation completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
	
	const monthStart = Date.now();
	console.log('� Aggregating monthly data...');
	await aggregateMonthlyData(userId);
	console.log(`   ✓ Monthly aggregation completed in ${((Date.now() - monthStart) / 1000).toFixed(1)}s`);
	
	const yearStart = Date.now();
	console.log('� Aggregating yearly data...');
	await aggregateYearlyData(userId);
	console.log(`   ✓ Yearly aggregation completed in ${((Date.now() - yearStart) / 1000).toFixed(1)}s`);

	const dailyStart = Date.now();
	console.log('� Aggregating daily effort (siste 400 dager)...');
	await aggregateDailyEffort(userId, generateDays(400));
	console.log(`   ✓ Daily effort aggregation completed in ${((Date.now() - dailyStart) / 1000).toFixed(1)}s`);

	console.log(`✅ All aggregations completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
}

// ─── Spending metric aggregation ──────────────────────────────────────────────

type PeriodType = 'week' | 'month' | 'year';

interface PeriodWindow {
	period: PeriodType;
	periodKey: string;
	startDate: string;
	endDate: string;
}

function buildPeriodWindows(fromDate: Date): PeriodWindow[] {
	const windows: PeriodWindow[] = [];
	const now = new Date();

	// Måneder (og dermed uker) siden fromDate
	const fromYear = fromDate.getFullYear();
	const toYear = now.getFullYear();

	for (let y = fromYear; y <= toYear; y++) {
		const startM = y === fromYear ? fromDate.getMonth() : 0;
		const endM = y === toYear ? now.getMonth() : 11;
		for (let m = startM; m <= endM; m++) {
			const start = new Date(y, m, 1);
			const end = new Date(y, m + 1, 0); // siste dag i måneden
			windows.push({
				period: 'month',
				periodKey: `${y}M${String(m + 1).padStart(2, '0')}`,
				startDate: start.toISOString().slice(0, 10),
				endDate: end.toISOString().slice(0, 10),
			});
		}
		windows.push({
			period: 'year',
			periodKey: String(y),
			startDate: `${y}-01-01`,
			endDate: `${y}-12-31`,
		});
	}

	return windows;
}

/**
 * Aggreger én spending-metrikk for gitte periodevindu.
 * Lagrer sum/avg/min/max/count + dailyBuckets i metric_aggregate_cache.
 */
async function aggregateOneSpendingMetric(
	userId: string,
	metricKey: string,
	filterCategory: string | undefined,
	filterSubcategory: string | undefined,
	isIncome: boolean,
	windows: PeriodWindow[],
): Promise<void> {
	for (const w of windows) {
		const catClause = filterCategory ? `AND resolved_category = '${filterCategory.replace(/'/g, "''")}'` : '';
		const subcatClause = filterSubcategory ? `AND resolved_subcategory = '${filterSubcategory.replace(/'/g, "''")}'` : '';
		const amountDirection = isIncome ? '> 0' : '< 0';
		const absFn = isIncome ? '' : 'ABS';

		// Daglige bucketer innenfor periodevinduet
		const bucketRows = await rawSql(
			`SELECT
				(timestamp AT TIME ZONE 'Europe/Oslo')::date::text AS day,
				SUM(${absFn ? `ABS(amount::numeric)` : `amount::numeric`}) AS day_sum,
				COUNT(*) AS day_count
			FROM categorized_events
			WHERE user_id = $1
			  AND amount::numeric ${amountDirection}
			  AND timestamp >= $2
			  AND timestamp < $3
			  ${catClause}
			  ${subcatClause}
			GROUP BY 1
			ORDER BY 1`,
			[userId, `${w.startDate}T00:00:00Z`, `${w.endDate}T23:59:59.999Z`],
		) as Array<{ day: string; day_sum: string; day_count: string }>;

		if (bucketRows.length === 0) continue;

		const values = bucketRows.map((r) => parseFloat(r.day_sum) || 0);
		const counts = bucketRows.map((r) => parseInt(r.day_count) || 0);
		const totalSum = values.reduce((a, b) => a + b, 0);
		const totalCount = counts.reduce((a, b) => a + b, 0);
		const valueAvg = totalCount > 0 ? totalSum / values.length : 0;
		const valueMin = Math.min(...values);
		const valueMax = Math.max(...values);
		const valueLatest = values[values.length - 1] ?? 0;
		const dailyBuckets = bucketRows.map((r) => ({ date: r.day, value: parseFloat(r.day_sum) || 0 }));

		await db
			.insert(metricAggregateCache)
			.values({
				userId,
				metricKey,
				period: w.period,
				periodKey: w.periodKey,
				startDate: w.startDate,
				endDate: w.endDate,
				valueSum: String(Math.round(totalSum * 100) / 100),
				valueAvg: String(Math.round(valueAvg * 100) / 100),
				valueMin: String(Math.round(valueMin * 100) / 100),
				valueMax: String(Math.round(valueMax * 100) / 100),
				valueCount: totalCount,
				valueLatest: String(Math.round(valueLatest * 100) / 100),
				dailyBuckets,
				computedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: [metricAggregateCache.userId, metricAggregateCache.metricKey, metricAggregateCache.period, metricAggregateCache.periodKey],
				set: {
					valueSum: sql`excluded.value_sum`,
					valueAvg: sql`excluded.value_avg`,
					valueMin: sql`excluded.value_min`,
					valueMax: sql`excluded.value_max`,
					valueCount: sql`excluded.value_count`,
					valueLatest: sql`excluded.value_latest`,
					dailyBuckets: sql`excluded.daily_buckets`,
					computedAt: sql`excluded.computed_at`,
					updatedAt: new Date(),
				},
			});
	}
}

/**
 * Aggreger alle aktive spending-metrikker for én bruker.
 * Kalles fra nattlig cron og etter SpareBank1-sync.
 */
export async function aggregateSpendingMetrics(userId: string, fromDate?: Date): Promise<void> {
	const from = fromDate ?? new Date(new Date().getFullYear() - 2, 0, 1); // 2 år tilbake som default
	const windows = buildPeriodWindows(from);
	if (windows.length === 0) return;

	const spendingMetrics = getAllMetrics().filter(
		(m) => m.domain === 'spending' || m.domain === 'income',
	);

	for (const def of spendingMetrics) {
		const isIncome = def.domain === 'income';
		await aggregateOneSpendingMetric(
			userId,
			def.key,
			def.filterCategory,
			def.filterSubcategory,
			isIncome,
			windows,
		);
	}
}

/**
 * Aggreger kun én spesifikk metrikk for én bruker (brukes ved widget-opprettelse).
 */
export async function aggregateSingleMetric(
	userId: string,
	metricKey: string,
	fromDate?: Date,
): Promise<void> {
	const metrics = getAllMetrics();
	const def = metrics.find((m) => m.key === metricKey);
	if (!def || (def.domain !== 'spending' && def.domain !== 'income')) return;

	const from = fromDate ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
	const windows = buildPeriodWindows(from);
	await aggregateOneSpendingMetric(
		userId,
		def.key,
		def.filterCategory,
		def.filterSubcategory,
		def.domain === 'income',
		windows,
	);
}

/**
 * Invalider cache-poster for en bruker der perioden overlapper med fromDate.
 * Kalles etter SpareBank1-sync for å tvinge re-beregning.
 */
export async function invalidateSpendingCache(userId: string, fromDate: Date): Promise<void> {
	await rawSql(
		`DELETE FROM metric_aggregate_cache
		 WHERE user_id = $1
		   AND end_date::date >= $2::date`,
		[userId, fromDate.toISOString().slice(0, 10)],
	);
}
