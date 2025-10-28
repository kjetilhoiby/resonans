import { db } from '$lib/db';
import { sensorEvents, sensorAggregates } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { generateWeeks, generateMonths, generateYears } from './time-periods';
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
	
	// Fetch ALL events once (much faster than per-week queries)
	const allEvents = await db.query.sensorEvents.findMany({
		where: eq(sensorEvents.userId, userId),
		orderBy: [sensorEvents.timestamp]
	});
	
	console.log(`   Processing ${periodsToAggregate.length} weeks with ${allEvents.length} total events...`);

	for (const week of periodsToAggregate) {
		// Filter events for this week
		const events = allEvents.filter(e => 
			e.timestamp >= week.startTime && e.timestamp <= week.endTime
		);

		if (events.length === 0) continue; // Skip empty weeks

		// Extract values for aggregation
		const weights = events.map((e) => e.data?.weight).filter((v): v is number => v !== undefined);
		const steps = events.map((e) => e.data?.steps).filter((v): v is number => v !== undefined);
		const sleepDurations = events
			.map((e) => e.data?.sleepDuration)
			.filter((v): v is number => v !== undefined);
		const calories = events.map((e) => e.data?.calories).filter((v): v is number => v !== undefined);
		const distances = events.map((e) => e.data?.distance).filter((v): v is number => v !== undefined);
		
		// Only get intense minutes from activity events
		const activityEvents = events.filter(e => e.eventType === 'activity');
		const intenseMinutes = activityEvents
			.map((e) => (e.data?.intense || 0) + (e.data?.moderate || 0))
			.filter((v) => v > 0);

		// Calculate metrics
		const metrics: any = {};

		if (weights.length > 0) {
			metrics.weight = {
				avg: avg(weights),
				min: min(weights),
				max: max(weights),
				latest: latest(weights),
				change: weights.length > 1 ? (latest(weights)! - weights[0]) : 0
			};
		}

		if (steps.length > 0) {
			metrics.steps = {
				sum: sum(steps),
				avg: avg(steps),
				max: max(steps)
			};
		}

		if (sleepDurations.length > 0) {
			// Convert seconds to hours
			const sleepHours = sleepDurations.map((s) => s / 3600);
			metrics.sleep = {
				avg: avg(sleepHours),
				min: min(sleepHours),
				max: max(sleepHours)
			};
		}

		if (calories.length > 0) {
			metrics.calories = {
				sum: sum(calories),
				avg: avg(calories)
			};
		}

		if (distances.length > 0) {
			metrics.distance = {
				sum: sum(distances),
				avg: avg(distances)
			};
		}

		if (intenseMinutes.length > 0) {
			metrics.intenseMinutes = {
				sum: sum(intenseMinutes),
				avg: avg(intenseMinutes)
			};
		}

		// Custom metrics
		const sleepLag = calculateSleepLag(events);
		if (sleepLag !== undefined) metrics.sleepLag = sleepLag;

		const earlyWake = calculateEarlyWake(events);
		if (earlyWake !== undefined) metrics.earlyWake = earlyWake;

		// Upsert aggregate
		await db
			.insert(sensorAggregates)
			.values({
				userId,
				period: 'week',
				periodKey: week.yearweek,
				year: week.year,
				startDate: week.startTime,
				endDate: week.endTime,
				metrics,
				eventCount: events.length
			})
			.onConflictDoUpdate({
				target: [sensorAggregates.userId, sensorAggregates.period, sensorAggregates.periodKey],
				set: {
					metrics,
					eventCount: events.length,
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
	
	// Fetch ALL events once (much faster than per-month queries)
	const allEvents = await db.query.sensorEvents.findMany({
		where: eq(sensorEvents.userId, userId),
		orderBy: [sensorEvents.timestamp]
	});
	
	console.log(`   Processing ${periodsToAggregate.length} months with ${allEvents.length} total events...`);

	for (const month of periodsToAggregate) {
		// Filter events for this month
		const events = allEvents.filter(e => 
			e.timestamp >= month.startTime && e.timestamp <= month.endTime
		);

		if (events.length === 0) continue; // Skip empty months

		// Same aggregation logic as weekly
		const weights = events.map((e) => e.data?.weight).filter((v): v is number => v !== undefined);
		const steps = events.map((e) => e.data?.steps).filter((v): v is number => v !== undefined);
		const sleepDurations = events
			.map((e) => e.data?.sleepDuration)
			.filter((v): v is number => v !== undefined);
		const calories = events.map((e) => e.data?.calories).filter((v): v is number => v !== undefined);
		const distances = events.map((e) => e.data?.distance).filter((v): v is number => v !== undefined);
		
		// Only get intense minutes from activity events
		const activityEvents = events.filter(e => e.eventType === 'activity');
		const intenseMinutes = activityEvents
			.map((e) => (e.data?.intense || 0) + (e.data?.moderate || 0))
			.filter((v) => v > 0);

		const metrics: any = {};

		if (weights.length > 0) {
			metrics.weight = {
				avg: avg(weights),
				min: min(weights),
				max: max(weights),
				latest: latest(weights),
				change: weights.length > 1 ? (latest(weights)! - weights[0]) : 0
			};
		}

		if (steps.length > 0) {
			metrics.steps = {
				sum: sum(steps),
				avg: avg(steps),
				max: max(steps)
			};
		}

		if (sleepDurations.length > 0) {
			const sleepHours = sleepDurations.map((s) => s / 3600);
			metrics.sleep = {
				avg: avg(sleepHours),
				min: min(sleepHours),
				max: max(sleepHours)
			};
		}

		if (calories.length > 0) {
			metrics.calories = {
				sum: sum(calories),
				avg: avg(calories)
			};
		}

		if (distances.length > 0) {
			metrics.distance = {
				sum: sum(distances),
				avg: avg(distances)
			};
		}

		if (intenseMinutes.length > 0) {
			metrics.intenseMinutes = {
				sum: sum(intenseMinutes),
				avg: avg(intenseMinutes)
			};
		}

		await db
			.insert(sensorAggregates)
			.values({
				userId,
				period: 'month',
				periodKey: month.yearmonth,
				year: month.year,
				startDate: month.startTime,
				endDate: month.endTime,
				metrics,
				eventCount: events.length
			})
			.onConflictDoUpdate({
				target: [sensorAggregates.userId, sensorAggregates.period, sensorAggregates.periodKey],
				set: {
					metrics,
					eventCount: events.length,
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
	
	// Fetch ALL events once (much faster than per-year queries)
	const allEvents = await db.query.sensorEvents.findMany({
		where: eq(sensorEvents.userId, userId),
		orderBy: [sensorEvents.timestamp]
	});
	
	console.log(`   Processing ${periodsToAggregate.length} years with ${allEvents.length} total events...`);

	for (const year of periodsToAggregate) {
		// Filter events for this year
		const events = allEvents.filter(e => 
			e.timestamp >= year.startTime && e.timestamp <= year.endTime
		);

		if (events.length === 0) continue;

		const weights = events.map((e) => e.data?.weight).filter((v): v is number => v !== undefined);
		const steps = events.map((e) => e.data?.steps).filter((v): v is number => v !== undefined);
		const sleepDurations = events
			.map((e) => e.data?.sleepDuration)
			.filter((v): v is number => v !== undefined);
		const calories = events.map((e) => e.data?.calories).filter((v): v is number => v !== undefined);
		const distances = events.map((e) => e.data?.distance).filter((v): v is number => v !== undefined);
		
		// Only get intense minutes from activity events
		const activityEvents = events.filter(e => e.eventType === 'activity');
		const intenseMinutes = activityEvents
			.map((e) => (e.data?.intense || 0) + (e.data?.moderate || 0))
			.filter((v) => v > 0);

		const metrics: any = {};

		if (weights.length > 0) {
			metrics.weight = {
				avg: avg(weights),
				min: min(weights),
				max: max(weights),
				latest: latest(weights),
				change: weights.length > 1 ? (latest(weights)! - weights[0]) : 0
			};
		}

		if (steps.length > 0) {
			metrics.steps = {
				sum: sum(steps),
				avg: avg(steps),
				max: max(steps)
			};
		}

		if (sleepDurations.length > 0) {
			const sleepHours = sleepDurations.map((s) => s / 3600);
			metrics.sleep = {
				avg: avg(sleepHours),
				min: min(sleepHours),
				max: max(sleepHours)
			};
		}

		if (calories.length > 0) {
			metrics.calories = {
				sum: sum(calories),
				avg: avg(calories)
			};
		}

		if (distances.length > 0) {
			metrics.distance = {
				sum: sum(distances),
				avg: avg(distances)
			};
		}

		if (intenseMinutes.length > 0) {
			metrics.intenseMinutes = {
				sum: sum(intenseMinutes),
				avg: avg(intenseMinutes)
			};
		}

		await db
			.insert(sensorAggregates)
			.values({
				userId,
				period: 'year',
				periodKey: year.year.toString(),
				year: year.year,
				startDate: year.startTime,
				endDate: year.endTime,
				metrics,
				eventCount: events.length
			})
			.onConflictDoUpdate({
				target: [sensorAggregates.userId, sensorAggregates.period, sensorAggregates.periodKey],
				set: {
					metrics,
					eventCount: events.length,
					updatedAt: new Date()
				}
			});
	}
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
