import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { sensors, sensorEvents, sensorAggregates } from '$lib/db/schema';
import { and, desc, eq, gte } from 'drizzle-orm';
import {
	SCREEN_TIME_DATATYPE,
	SCREEN_TIME_WEEK_DATATYPE,
	SCREEN_TIME_CATEGORY_LABELS
} from '$lib/server/integrations/screen-time';
import {
	listScreenTimeGoals,
	evaluateScreenTimeGoal,
	type ScreenTimeMetric
} from '$lib/server/integrations/screen-time-goals';

function metricFromAggregate(row: { metrics: unknown } | undefined | null): ScreenTimeMetric | null {
	const m = (row?.metrics as Record<string, unknown> | undefined)?.screenTime as ScreenTimeMetric | undefined;
	return m ?? null;
}

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.userId;

	const sensor = await db.query.sensors.findFirst({
		columns: { id: true },
		where: and(eq(sensors.provider, 'screen_time'), eq(sensors.userId, userId))
	});

	// Ukesaggregater med skjermtid (nyeste først). Bruk de to nyeste som «denne»/«forrige».
	const weekAggs = await db.query.sensorAggregates.findMany({
		where: and(eq(sensorAggregates.userId, userId), eq(sensorAggregates.period, 'week')),
		orderBy: [desc(sensorAggregates.startDate)],
		limit: 12
	});
	const weeksWithScreen = weekAggs.filter((w) => metricFromAggregate(w) !== null);
	const thisWeekRow = weeksWithScreen[0] ?? null;
	const prevWeekRow = weeksWithScreen[1] ?? null;
	const thisWeek = metricFromAggregate(thisWeekRow);
	const prevWeek = metricFromAggregate(prevWeekRow);

	// Mål + evaluering mot siste/forrige uke
	const goalRecords = await listScreenTimeGoals(userId);
	const goals = goalRecords.map((g) => evaluateScreenTimeGoal(g, thisWeek, prevWeek));

	// Daglige totaler siste 21 dager (for søylegraf)
	let dailySeries: Array<{ date: string; totalMinutes: number; socialMinutes: number; detailed: boolean }> = [];
	let topApps: Array<{ name: string; minutes: number }> = [];
	if (sensor) {
		const since = new Date();
		since.setDate(since.getDate() - 21);
		const dayEvents = await db.query.sensorEvents.findMany({
			where: and(
				eq(sensorEvents.sensorId, sensor.id),
				eq(sensorEvents.dataType, SCREEN_TIME_DATATYPE),
				gte(sensorEvents.timestamp, since)
			),
			orderBy: [sensorEvents.timestamp]
		});
		dailySeries = dayEvents.map((e) => {
			const d = (e.data ?? {}) as Record<string, any>;
			return {
				date: e.timestamp.toISOString().slice(0, 10),
				totalMinutes: typeof d.totalMinutes === 'number' ? d.totalMinutes : 0,
				socialMinutes: typeof d.categories?.social === 'number' ? d.categories.social : 0,
				detailed: d.captureType === 'daily'
			};
		});

		// Topp-apper fra nyeste ukesoppsummering
		const latestWeekEvent = await db.query.sensorEvents.findFirst({
			where: and(eq(sensorEvents.sensorId, sensor.id), eq(sensorEvents.dataType, SCREEN_TIME_WEEK_DATATYPE)),
			orderBy: [desc(sensorEvents.timestamp)]
		});
		const apps = (latestWeekEvent?.data as Record<string, any> | undefined)?.apps as
			| Record<string, number>
			| undefined;
		if (apps) {
			topApps = Object.entries(apps)
				.map(([name, minutes]) => ({ name, minutes: Number(minutes) || 0 }))
				.sort((a, b) => b.minutes - a.minutes)
				.slice(0, 8);
		}
	}

	return {
		connected: Boolean(sensor),
		thisWeek,
		prevWeek,
		thisWeekKey: thisWeekRow?.periodKey ?? null,
		prevWeekKey: prevWeekRow?.periodKey ?? null,
		goals,
		dailySeries,
		topApps,
		categoryLabels: SCREEN_TIME_CATEGORY_LABELS
	};
};
