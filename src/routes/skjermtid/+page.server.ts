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
	basisLabel,
	type ScreenTimeMetric
} from '$lib/server/integrations/screen-time-goals';

function metricFromAggregate(row: { metrics: unknown } | undefined | null): ScreenTimeMetric | null {
	const m = (row?.metrics as Record<string, unknown> | undefined)?.screenTime as ScreenTimeMetric | undefined;
	return m ?? null;
}

function toISODate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
function weekLabel(start: Date): string {
	const end = new Date(start);
	end.setDate(end.getDate() + 6);
	const sameMonth = start.getMonth() === end.getMonth();
	const startStr = sameMonth ? `${start.getDate()}.` : `${start.getDate()}. ${MONTHS_SHORT[start.getMonth()]}`;
	return `${startStr}–${end.getDate()}. ${MONTHS_SHORT[end.getMonth()]}`;
}

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.userId;

	const sensor = await db.query.sensors.findFirst({
		columns: { id: true },
		where: and(eq(sensors.provider, 'screen_time'), eq(sensors.userId, userId))
	});

	// Ukesaggregater med skjermtid (nyeste først).
	const weekAggs = (
		await db.query.sensorAggregates.findMany({
			where: and(eq(sensorAggregates.userId, userId), eq(sensorAggregates.period, 'week')),
			orderBy: [desc(sensorAggregates.startDate)],
			limit: 16
		})
	).filter((w) => metricFromAggregate(w) !== null);

	const goalRecords = await listScreenTimeGoals(userId);
	const goalsForManagement = goalRecords.map((g) => ({ id: g.id, title: g.title, basisLabel: basisLabel(g.goal) }));

	// Hent dags- og ukesevents innenfor spennet av ukene vi viser, og bøtt per uke.
	let dayEvents: Array<{ ts: Date; total: number; social: number; detailed: boolean }> = [];
	let weekEvents: Array<{ ts: Date; apps: Record<string, number> | undefined }> = [];
	if (sensor && weekAggs.length > 0) {
		const earliest = weekAggs[weekAggs.length - 1].startDate;
		const [days, wevents] = await Promise.all([
			db.query.sensorEvents.findMany({
				where: and(
					eq(sensorEvents.sensorId, sensor.id),
					eq(sensorEvents.dataType, SCREEN_TIME_DATATYPE),
					gte(sensorEvents.timestamp, earliest)
				),
				orderBy: [sensorEvents.timestamp]
			}),
			db.query.sensorEvents.findMany({
				where: and(
					eq(sensorEvents.sensorId, sensor.id),
					eq(sensorEvents.dataType, SCREEN_TIME_WEEK_DATATYPE),
					gte(sensorEvents.timestamp, earliest)
				),
				orderBy: [sensorEvents.timestamp]
			})
		]);
		dayEvents = days.map((e) => {
			const d = (e.data ?? {}) as Record<string, any>;
			return {
				ts: e.timestamp,
				total: typeof d.totalMinutes === 'number' ? d.totalMinutes : 0,
				social: typeof d.categories?.social === 'number' ? d.categories.social : 0,
				detailed: d.captureType === 'daily'
			};
		});
		weekEvents = wevents.map((e) => ({
			ts: e.timestamp,
			apps: (e.data as Record<string, any> | undefined)?.apps as Record<string, number> | undefined
		}));
	}

	const weeks = weekAggs.map((agg, idx) => {
		const start = agg.startDate;
		const end = agg.endDate;
		const metric = metricFromAggregate(agg)!;

		// Fast man–søn-array (7 slots), totaler fra dagsevents i ukens datointervall.
		const dayISOs: string[] = [];
		for (let i = 0; i < 7; i++) {
			const d = new Date(start);
			d.setDate(d.getDate() + i);
			dayISOs.push(toISODate(d));
		}
		const byDate = new Map<string, { total: number; social: number; detailed: boolean }>();
		for (const ev of dayEvents) {
			if (ev.ts < start || ev.ts > end) continue;
			byDate.set(toISODate(ev.ts), { total: ev.total, social: ev.social, detailed: ev.detailed });
		}
		const weekDays = dayISOs.map((iso) => {
			const hit = byDate.get(iso);
			return {
				date: iso,
				totalMinutes: hit?.total ?? 0,
				socialMinutes: hit?.social ?? 0,
				detailed: hit?.detailed ?? false
			};
		});

		// Ukesoppsummering (apper) i ukens intervall → samme uke som resten.
		const weekEvent = weekEvents.find((w) => w.ts >= start && w.ts <= end);
		const topApps = weekEvent?.apps
			? Object.entries(weekEvent.apps)
					.map(([name, minutes]) => ({ name, minutes: Number(minutes) || 0 }))
					.sort((a, b) => b.minutes - a.minutes)
					.slice(0, 8)
			: [];

		// Mål evaluert mot denne uka vs. uka før (neste i desc-rekkefølge).
		const prevMetric = metricFromAggregate(weekAggs[idx + 1]);
		const goals = goalRecords.map((g) => evaluateScreenTimeGoal(g, metric, prevMetric));

		return {
			periodKey: agg.periodKey,
			weekStartISO: toISODate(start),
			label: weekLabel(start),
			hasWeekScreenshot: Boolean(weekEvent),
			metric,
			weekDays,
			topApps,
			goals
		};
	});

	// Default = nyeste uke med data (der ferske dagsbilder / time-for-time havner).
	// Brukeren kan bla til en eldre, komplett uke med pilene.
	const defaultIndex = 0;

	return {
		connected: Boolean(sensor),
		weeks,
		defaultIndex,
		goalsForManagement,
		categoryLabels: SCREEN_TIME_CATEGORY_LABELS
	};
};
