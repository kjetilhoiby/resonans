import { db } from '$lib/db';
import { sensorAggregates, sensorEvents, sensors, goals as goalsTable, themes } from '$lib/db/schema';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { buildUnifiedWorkoutActivities } from '$lib/server/activity-layer';

// Dekker 365d-vinduet for løpe-widgeten: dashboardets «løpt»-tall summeres fra
// dette deduplikerte aktivitetslaget, så lookbacken må romme det lengste vinduet.
const HEALTH_DASHBOARD_WORKOUT_LOOKBACK_DAYS = 400;

export async function loadHealthDashboardData(userId: string) {
	const t0 = performance.now();

	const [
		sensorChainResult,
		goalsChainResult,
		[weeklyData, monthlyData, yearlyData, dailyData],
		unifiedActivities,
		[weightEventCountRow, weightAggregateCountRow]
	] = await Promise.all([
		// Chain A: sensors → recentHealthEvents
		(async () => {
			const healthSensors = await db.query.sensors.findMany({
				where: and(
					eq(sensors.userId, userId),
					or(eq(sensors.type, 'health_tracker'), eq(sensors.type, 'workout_files'))
				),
				orderBy: [desc(sensors.updatedAt)]
			});
			const healthSensorIds = healthSensors.map((sensor) => sensor.id);
			const recentHealthEvents = healthSensorIds.length
				? await db
						.select({
							id: sensorEvents.id,
							timestamp: sensorEvents.timestamp,
							dataType: sensorEvents.dataType,
							data: sql<Record<string, unknown>>`${sensorEvents.data} - 'trackPoints' - 'rawResponse' - 'laps' - 'samples'`,
						})
						.from(sensorEvents)
						.where(
							and(
								eq(sensorEvents.userId, userId),
								inArray(sensorEvents.sensorId, healthSensorIds)
							)
						)
						.orderBy(desc(sensorEvents.timestamp))
						.limit(500)
				: [];
			return { healthSensors, recentHealthEvents };
		})(),
		// Chain B: theme → goals
		(async () => {
			const healthTheme = await db.query.themes.findFirst({
				where: and(eq(themes.userId, userId), eq(themes.name, 'Helse'))
			});
			const healthGoals = healthTheme ? await db.query.goals.findMany({
				where: and(
					eq(goalsTable.userId, userId),
					eq(goalsTable.themeId, healthTheme.id),
					inArray(goalsTable.status, ['active', 'paused'])
				)
			}) : [];
			return { healthGoals };
		})(),
		// Group C: aggregates
		Promise.all([
			db.query.sensorAggregates.findMany({
				where: and(eq(sensorAggregates.userId, userId), eq(sensorAggregates.period, 'week')),
				orderBy: [desc(sensorAggregates.startDate)]
			}),
			db.query.sensorAggregates.findMany({
				where: and(eq(sensorAggregates.userId, userId), eq(sensorAggregates.period, 'month')),
				orderBy: [desc(sensorAggregates.startDate)]
			}),
			db.query.sensorAggregates.findMany({
				where: and(eq(sensorAggregates.userId, userId), eq(sensorAggregates.period, 'year')),
				orderBy: [desc(sensorAggregates.startDate)]
			}),
			db.query.sensorAggregates.findMany({
				where: and(eq(sensorAggregates.userId, userId), eq(sensorAggregates.period, 'day')),
				orderBy: [desc(sensorAggregates.startDate)],
				limit: 400
			})
		]),
		// Group D: workout activities (the slowest query — runs in parallel now)
		buildUnifiedWorkoutActivities(userId, {
			since: new Date(Date.now() - 1000 * 60 * 60 * 24 * HEALTH_DASHBOARD_WORKOUT_LOOKBACK_DAYS),
			limit: 2000
		}),
		// Group E: weight counts
		Promise.all([
			db
				.select({ count: sql<number>`count(*)` })
				.from(sensorEvents)
				.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'weight'))),
			db
				.select({ count: sql<number>`count(*)` })
				.from(sensorAggregates)
				.where(and(eq(sensorAggregates.userId, userId), sql`metrics ? 'weight'`))
		])
	]);

	const { healthSensors, recentHealthEvents } = sensorChainResult;
	const { healthGoals } = goalsChainResult;
	const weightEventCount = weightEventCountRow[0]?.count ?? 0;
	const weightAggregateCount = weightAggregateCountRow[0]?.count ?? 0;

	console.log(
		`[perf][health-dashboard] user=${userId} step=total ms=${(performance.now() - t0).toFixed(0)} workouts=${unifiedActivities.length} recentEvents=${recentHealthEvents.length} goals=${healthGoals.length}`
	);

	const dailyEffortSeries = dailyData
		.slice()
		.reverse()
		.map((row) => ({
			date: row.periodKey,
			effort: (row.metrics as { dailyEffort?: { total?: number } } | null)?.dailyEffort?.total ?? 0
		}));

	return {
		weekly: weeklyData.reverse(),
		monthly: monthlyData.reverse(),
		yearly: yearlyData.reverse(),
		dailyEffort: dailyEffortSeries,
		sources: healthSensors.map((sensor) => ({
			id: sensor.id,
			name: sensor.name,
			provider: sensor.provider,
			isActive: sensor.isActive,
			lastSync: sensor.lastSync?.toISOString() ?? null
		})),
		recentEvents: recentHealthEvents.map((event) => ({
			id: event.id,
			timestamp: event.timestamp.toISOString(),
			dataType: event.dataType ?? 'ukjent',
			data: event.data ?? {}
		})),
		activityLayer: {
			version: 1,
			workouts: unifiedActivities
		},
		tooling: {
			querySensorDataTool: true,
			tables: {
				sensorEvents: 'sensor_events',
				sensorAggregates: 'sensor_aggregates'
			},
			weightEventCount,
			weightAggregateCount,
			healthSensorsCount: healthSensors.length
		},
		goals: healthGoals.map((goal) => ({
			id: goal.id,
			title: goal.title,
			description: goal.description,
			status: goal.status,
			metadata: (goal.metadata ?? {}) as Record<string, unknown>
		}))
	};
}