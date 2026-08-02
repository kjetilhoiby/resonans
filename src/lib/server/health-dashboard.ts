import { db } from '$lib/db';
import { sensorAggregates, sensors } from '$lib/db/schema';
import { and, desc, eq, or } from 'drizzle-orm';
import { loadHealthOverview } from '$lib/server/health/health-overview';

/**
 * Helse-mortemaet: oversikt, ikke detaljer.
 *
 * Aktivitetslaget (inntil 2000 økter) og rå sensorhendelser (500 rader) bodde
 * her fram til splitten, men mates nå av training-dashboard — de er
 * treningsdetaljer, og var dessuten den tregeste spørringen på flaten.
 */
export async function loadHealthDashboardData(userId: string) {
	const t0 = performance.now();

	const [healthSensors, [weeklyData, monthlyData, yearlyData, dailyData]] = await Promise.all([
		db.query.sensors.findMany({
			where: and(
				eq(sensors.userId, userId),
				or(eq(sensors.type, 'health_tracker'), eq(sensors.type, 'workout_files'))
			),
			orderBy: [desc(sensors.updatedAt)]
		}),
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
		])
	]);

	const dailyEffortSeries = dailyData
		.slice()
		.reverse()
		.map((row) => ({
			date: row.periodKey,
			effort: (row.metrics as { dailyEffort?: { total?: number } } | null)?.dailyEffort?.total ?? 0
		}));

	// NB: reverse() muterer. Rekkefølgen snus til eldste-først her, og oversikten
	// leser samme arrays — den forventer nyeste sist.
	const weekly = weeklyData.reverse();
	const monthly = monthlyData.reverse();

	const overview = await loadHealthOverview(userId, weekly, monthly);

	console.log(
		`[perf][health-dashboard] user=${userId} step=total ms=${(performance.now() - t0).toFixed(0)} signals=${overview.signals.length}`
	);

	return {
		weekly,
		monthly,
		yearly: yearlyData.reverse(),
		subthemes: overview.subthemes,
		signals: overview.signals,
		dailyEffort: dailyEffortSeries,
		sources: healthSensors.map((sensor) => ({
			id: sensor.id,
			name: sensor.name,
			provider: sensor.provider,
			isActive: sensor.isActive,
			lastSync: sensor.lastSync?.toISOString() ?? null
		}))
	};
}
