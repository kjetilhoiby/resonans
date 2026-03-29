import { db } from '$lib/db';
import { sensorAggregates, sensorEvents, sensors } from '$lib/db/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';

export async function loadHealthDashboardData(userId: string) {
	const healthSensors = await db.query.sensors.findMany({
		where: and(eq(sensors.userId, userId), eq(sensors.type, 'health_tracker')),
		orderBy: [desc(sensors.updatedAt)]
	});

	const healthSensorIds = healthSensors.map((sensor) => sensor.id);
	const recentHealthEvents = healthSensorIds.length
		? await db.query.sensorEvents.findMany({
				where: and(
					eq(sensorEvents.userId, userId),
					inArray(sensorEvents.sensorId, healthSensorIds)
				),
				orderBy: [desc(sensorEvents.timestamp)],
				limit: 80
			})
		: [];

	const [weeklyData, monthlyData, yearlyData] = await Promise.all([
		db.query.sensorAggregates.findMany({
			where: and(eq(sensorAggregates.userId, userId), eq(sensorAggregates.period, 'week')),
			orderBy: [desc(sensorAggregates.startDate)],
			limit: 12
		}),
		db.query.sensorAggregates.findMany({
			where: and(eq(sensorAggregates.userId, userId), eq(sensorAggregates.period, 'month')),
			orderBy: [desc(sensorAggregates.startDate)],
			limit: 12
		}),
		db.query.sensorAggregates.findMany({
			where: and(eq(sensorAggregates.userId, userId), eq(sensorAggregates.period, 'year')),
			orderBy: [desc(sensorAggregates.startDate)]
		})
	]);

	return {
		weekly: weeklyData.reverse(),
		monthly: monthlyData.reverse(),
		yearly: yearlyData.reverse(),
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
		}))
	};
}