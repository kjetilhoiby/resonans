import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes, sensorEvents } from '$lib/db/schema';
import { eq, and, gte, lte, sql } from 'drizzle-orm';

/**
 * GET /api/tema/[id]/health-stats
 * 
 * Return health statistics for a trip theme:
 * - Average weight 7 days before trip start
 * - Average weight first 7 days after trip end
 * - Steps per day during trip
 * - Number of workouts during trip
 * - Average sleep per day during trip
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const userId = locals.userId;

	// Verify the theme belongs to this user and get trip dates
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, userId)),
		columns: { tripProfile: true }
	});

	if (!theme) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const profile = (theme.tripProfile ?? {}) as {
		startDate?: string;
		endDate?: string;
	};

	if (!profile.startDate || !profile.endDate) {
		return json({ error: 'Tur mangler start- eller sluttdato' }, { status: 400 });
	}

	const startDate = new Date(profile.startDate + 'T00:00:00Z');
	const endDate = new Date(profile.endDate + 'T23:59:59Z');

	// Calculate date ranges
	const before7Start = new Date(startDate);
	before7Start.setUTCDate(before7Start.getUTCDate() - 7);
	const before7End = new Date(startDate);
	before7End.setUTCDate(before7End.getUTCDate() - 1);
	before7End.setUTCHours(23, 59, 59, 999);

	const after7Start = new Date(endDate);
	after7Start.setUTCDate(after7Start.getUTCDate() + 1);
	after7Start.setUTCHours(0, 0, 0, 0);
	const after7End = new Date(after7Start);
	after7End.setUTCDate(after7End.getUTCDate() + 6);
	after7End.setUTCHours(23, 59, 59, 999);

	// Fetch weight data for 7 days before
	const weightBefore = await db
		.select({
			weight: sql<number>`(data->>'weight')::numeric`,
			timestamp: sensorEvents.timestamp
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'weight'),
				gte(sensorEvents.timestamp, before7Start),
				lte(sensorEvents.timestamp, before7End),
				sql`data->>'weight' IS NOT NULL`
			)
		)
		.orderBy(sensorEvents.timestamp);

	// Fetch weight data for first 7 days after
	const weightAfter = await db
		.select({
			weight: sql<number>`(data->>'weight')::numeric`,
			timestamp: sensorEvents.timestamp
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'weight'),
				gte(sensorEvents.timestamp, after7Start),
				lte(sensorEvents.timestamp, after7End),
				sql`data->>'weight' IS NOT NULL`
			)
		)
		.orderBy(sensorEvents.timestamp);

	// Fetch steps data during trip
	const stepsData = await db
		.select({
			steps: sql<number>`(data->>'steps')::numeric`,
			date: sql<string>`timestamp::date`,
			timestamp: sensorEvents.timestamp
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'activity'),
				gte(sensorEvents.timestamp, startDate),
				lte(sensorEvents.timestamp, endDate),
				sql`data->>'steps' IS NOT NULL`
			)
		)
		.orderBy(sensorEvents.timestamp);

	// Fetch workout data during trip
	const workouts = await db
		.select({
			id: sensorEvents.id,
			timestamp: sensorEvents.timestamp,
			sportType: sql<string>`COALESCE(data->>'sportType', 'unknown')`,
			distance: sql<number>`COALESCE((data->>'distance')::numeric / 1000.0, NULL)`,
			duration: sql<number>`(data->>'duration')::numeric`,
			category: sql<number>`(data->>'category')::integer`
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'workout'),
				gte(sensorEvents.timestamp, startDate),
				lte(sensorEvents.timestamp, endDate)
			)
		)
		.orderBy(sensorEvents.timestamp);

	// Fetch sleep data during trip
	const sleepData = await db
		.select({
			duration: sql<number>`(data->>'sleepDuration')::numeric / 3600.0`, // Convert seconds to hours
			date: sql<string>`timestamp::date`,
			timestamp: sensorEvents.timestamp
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'sleep'),
				gte(sensorEvents.timestamp, startDate),
				lte(sensorEvents.timestamp, endDate),
				sql`data->>'sleepDuration' IS NOT NULL`
			)
		)
		.orderBy(sensorEvents.timestamp);

	// Calculate averages
	const avgWeightBefore = weightBefore.length > 0
		? weightBefore.reduce((sum, w) => {
			const weight = typeof w.weight === 'string' ? parseFloat(w.weight) : w.weight;
			return sum + weight;
		}, 0) / weightBefore.length
		: null;

	const avgWeightAfter = weightAfter.length > 0
		? weightAfter.reduce((sum, w) => {
			const weight = typeof w.weight === 'string' ? parseFloat(w.weight) : w.weight;
			return sum + weight;
		}, 0) / weightAfter.length
		: null;

	// Group steps by date and calculate daily totals
	const stepsByDate = new Map<string, number[]>();
	for (const s of stepsData) {
		if (!stepsByDate.has(s.date)) {
			stepsByDate.set(s.date, []);
		}
		// Convert to number explicitly (PostgreSQL returns as string)
		const stepsValue = typeof s.steps === 'string' ? parseInt(s.steps, 10) : s.steps;
		stepsByDate.get(s.date)!.push(stepsValue);
	}

	// For each day, take the MAX value (Withings stores one daily total, but there might be duplicates)
	const dailySteps = Array.from(stepsByDate.entries()).map(([date, values]) => ({
		date,
		steps: Math.max(...values) // Take highest value to avoid averaging duplicates
	})).sort((a, b) => a.date.localeCompare(b.date));

	const avgStepsPerDay = dailySteps.length > 0
		? Math.round(dailySteps.reduce((sum, d) => sum + d.steps, 0) / dailySteps.length)
		: null;

	// Group sleep by date
	const sleepByDate = new Map<string, number[]>();
	for (const s of sleepData) {
		if (!sleepByDate.has(s.date)) {
			sleepByDate.set(s.date, []);
		}
		// Convert to number explicitly
		const duration = typeof s.duration === 'string' ? parseFloat(s.duration) : s.duration;
		sleepByDate.get(s.date)!.push(duration);
	}

	const dailySleep = Array.from(sleepByDate.entries()).map(([date, values]) => ({
		date,
		hours: Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10
	})).sort((a, b) => a.date.localeCompare(b.date));

	const avgSleepPerDay = dailySleep.length > 0
		? Math.round((dailySleep.reduce((sum, d) => sum + d.hours, 0) / dailySleep.length) * 10) / 10
		: null;

	return json({
		success: true,
		data: {
			weight: {
				avgBefore7Days: avgWeightBefore ? Math.round(avgWeightBefore * 10) / 10 : null,
				avgAfter7Days: avgWeightAfter ? Math.round(avgWeightAfter * 10) / 10 : null,
				change: (avgWeightBefore && avgWeightAfter) 
					? Math.round((avgWeightAfter - avgWeightBefore) * 10) / 10 
					: null,
				measurementsBefore: weightBefore.length,
				measurementsAfter: weightAfter.length
			},
			steps: {
				avgPerDay: avgStepsPerDay,
				dailySteps,
				daysWithData: dailySteps.length
			},
			workouts: {
				count: workouts.length,
				list: workouts.map((w) => {
					// Normalize distance to km
					let distanceKm = null;
					if (w.distance) {
						const dist = typeof w.distance === 'string' ? parseFloat(w.distance) : w.distance;
						distanceKm = dist > 100 ? Math.round((dist / 1000) * 10) / 10 : Math.round(dist * 10) / 10;
					}
					
					return {
						id: w.id,
						timestamp: w.timestamp,
						date: new Date(w.timestamp).toISOString().split('T')[0],
						sportType: w.sportType || 'unknown',
						distance: distanceKm,
						duration: w.duration ? Math.round(w.duration / 60) : null, // Convert to minutes
						category: w.category // Include for debugging
					};
				})
			},
			sleep: {
				avgPerDay: avgSleepPerDay,
				dailySleep,
				daysWithData: dailySleep.length
			}
		}
	});
};
