import { db } from '$lib/db';
import { sensorAggregates, sensorEvents, sensors } from '$lib/db/schema';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { loadHealthOverview } from '$lib/server/health/health-overview';

/**
 * Vekt- og øktshendelser som målberegningene trenger.
 *
 * Mål-fanen regner delta for `weight_change` og `running_distance` mot
 * enkelthendelser (`ThemeDataTab.goalDelta`), og vektmål-opprettingen
 * forhåndsutfyller siste veiing (`HealthGoalCreation.getLatestWeight`). Mål kan
 * ligge på hvilket som helst tema i helse-familien, men Mål-fanen bor på
 * mortemaet — så hendelsene må hit.
 *
 * Splitten i august 2026 fjernet den gamle 500-raders hendelsesdumpen herfra og
 * la den på Trening. Konsumentene brukte `?.` og feltet var valgfritt i typen,
 * så begge målberegningene falt stille til null i stedet for å feile. Denne
 * versjonen henter bare de to datatypene de faktisk leser.
 */
const GOAL_EVENT_TYPES = ['weight', 'workout'] as const;
const GOAL_EVENT_LIMIT = 400;

async function loadGoalEvents(userId: string, sensorIds: string[]) {
	if (sensorIds.length === 0) return [];

	const events = await db
		.select({
			id: sensorEvents.id,
			timestamp: sensorEvents.timestamp,
			dataType: sensorEvents.dataType,
			data: sensorEvents.data
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				inArray(sensorEvents.sensorId, sensorIds),
				inArray(sensorEvents.dataType, [...GOAL_EVENT_TYPES])
			)
		)
		.orderBy(desc(sensorEvents.timestamp))
		.limit(GOAL_EVENT_LIMIT);

	return events.map((event) => ({
		id: event.id,
		timestamp: event.timestamp.toISOString(),
		dataType: event.dataType ?? 'ukjent',
		data: (event.data ?? {}) as Record<string, unknown>
	}));
}

/**
 * Helse-mortemaet: oversikt, ikke detaljer.
 *
 * Aktivitetslaget (inntil 2000 økter), rå sensorhendelser (500 rader) og den
 * daglige effort-serien (400 rader) bodde her fram til splitten, men mates nå
 * av training-dashboard — de er treningsdetaljer, og aktivitetslaget var
 * dessuten den tregeste spørringen på flaten.
 *
 * Det som blir igjen er oversikten: undertema-stripe, signaler, program og
 * periodetabellen.
 */
export async function loadHealthDashboardData(userId: string) {
	const t0 = performance.now();

	const [healthSensors, [weeklyData, monthlyData, yearlyData]] = await Promise.all([
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
			})
		])
	]);

	// NB: reverse() muterer. Rekkefølgen snus til eldste-først her, og oversikten
	// leser samme arrays — den forventer nyeste sist.
	const weekly = weeklyData.reverse();
	const monthly = monthlyData.reverse();

	const goalEvents = await loadGoalEvents(
		userId,
		healthSensors.map((sensor) => sensor.id)
	);

	// Undertema-stripen og signalene er en berikelse av flaten, ikke fundamentet.
	// Uten denne guarden tar en feil i oversiktslaget med seg widgets, metrikkgrid
	// og kilder også — slik det skjedde da signal-leseren kastet «not iterable».
	const overview = await loadHealthOverview(userId, weekly, monthly).catch((err) => {
		console.error('[health-dashboard] oversikt feilet, degraderer', err);
		return { subthemes: [], signals: [] };
	});

	console.log(
		`[perf][health-dashboard] user=${userId} step=total ms=${(performance.now() - t0).toFixed(0)} signals=${overview.signals.length}`
	);

	return {
		weekly,
		monthly,
		yearly: yearlyData.reverse(),
		subthemes: overview.subthemes,
		signals: overview.signals,
		recentEvents: goalEvents,
		sources: healthSensors.map((sensor) => ({
			id: sensor.id,
			name: sensor.name,
			provider: sensor.provider,
			isActive: sensor.isActive,
			lastSync: sensor.lastSync?.toISOString() ?? null
		}))
	};
}
