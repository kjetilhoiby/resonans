import { db, sql as rawSql } from '$lib/db';
import { sensorEvents, sensorAggregates, metricAggregateCache } from '$lib/db/schema';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { getAllMetrics } from '$lib/server/services/metric-definition-service';
import { generateWeeks, generateMonths, generateYears, getCurrentWeek, getCurrentMonth, getCurrentYear, getWeeksSince, getMonthsSince, getYearsSince } from './time-periods';
import type { WeekPeriod, MonthPeriod, YearPeriod } from './time-periods';

/**
 * Calculate average, excluding nulls
 */
function avg(values: (number | undefined)[]): number | undefined {
	const valid = values.filter((v): v is number => v !== undefined && v !== null);
	if (valid.length === 0) return undefined;
	return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

/**
 * Calculate sum, excluding nulls
 */
function sum(values: (number | undefined)[]): number | undefined {
	const valid = values.filter((v): v is number => v !== undefined && v !== null);
	if (valid.length === 0) return undefined;
	return valid.reduce((sum, v) => sum + v, 0);
}

/**
 * Calculate min
 */
function min(values: (number | undefined)[]): number | undefined {
	const valid = values.filter((v): v is number => v !== undefined && v !== null);
	if (valid.length === 0) return undefined;
	return Math.min(...valid);
}

/**
 * Calculate max
 */
function max(values: (number | undefined)[]): number | undefined {
	const valid = values.filter((v): v is number => v !== undefined && v !== null);
	if (valid.length === 0) return undefined;
	return Math.max(...valid);
}

/**
 * Get latest non-null value
 */
function latest(values: (number | undefined)[]): number | undefined {
	for (let i = values.length - 1; i >= 0; i--) {
		if (values[i] !== undefined && values[i] !== null) {
			return values[i];
		}
	}
	return undefined;
}

/**
 * Calculate custom sleep lag metric
 * Your logic: 100 - (% awake time between 22:00 and 00:00)
 */
function calculateSleepLag(events: any[]): number | undefined {
	// TODO: Implement your specific sleep lag calculation
	// This requires parsing sleep session times and calculating overlap
	return undefined;
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

		const sleepLag = calculateSleepLag(events);
		if (sleepLag !== undefined) metrics.sleepLag = sleepLag;
		const earlyWake = calculateEarlyWake(events);
		if (earlyWake !== undefined) metrics.earlyWake = earlyWake;

		rows.push({ userId, period: 'week', periodKey: week.yearweek, year: week.year, startDate: week.startTime, endDate: week.endTime, metrics, eventCount: events.length });
	}

	if (rows.length > 0) {
		await db.insert(sensorAggregates).values(rows).onConflictDoUpdate({
			target: [sensorAggregates.userId, sensorAggregates.period, sensorAggregates.periodKey],
			set: { metrics: sql`excluded.metrics`, eventCount: sql`excluded.event_count`, updatedAt: new Date() }
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

		rows.push({ userId, period: 'month', periodKey: month.yearmonth, year: month.year, startDate: month.startTime, endDate: month.endTime, metrics, eventCount: events.length });
	}

	if (rows.length > 0) {
		await db.insert(sensorAggregates).values(rows).onConflictDoUpdate({
			target: [sensorAggregates.userId, sensorAggregates.period, sensorAggregates.periodKey],
			set: { metrics: sql`excluded.metrics`, eventCount: sql`excluded.event_count`, updatedAt: new Date() }
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
			set: { metrics: sql`excluded.metrics`, eventCount: sql`excluded.event_count`, updatedAt: new Date() }
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
