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
	screenTimeMetricFromAggregate
} from '$lib/server/integrations/screen-time-goals';
import {
	buildCumulativeWeekSeries,
	hourlyArrayFromBuckets,
	toISODate,
	weekLabel
} from '$lib/utils/screen-time-series';
import { isoWeekKeyToMonday } from '$lib/server/integrations/time-periods';

/**
 * Skjermtid-dashboardet: uker med dagsfordeling, akkumulert serie, topp-apper
 * og målevaluering. Deles av /skjermtid-ruten og Skjermtid-undertemaet
 * (/api/tema/[id]/dashboard/screentime), så begge viser nøyaktig samme bilde.
 *
 * Ren lesing — opplasting og parsing av skjermbilder bor i
 * /api/sensors/screen-time/*.
 */
export async function loadScreenTimeDashboardData(userId: string) {
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
	).filter((w) => screenTimeMetricFromAggregate(w) !== null);

	const goalRecords = await listScreenTimeGoals(userId);
	const goalsForManagement = goalRecords.map((g) => ({
		id: g.id,
		title: g.title,
		basisLabel: basisLabel(g.goal)
	}));

	// Hent dags- og ukesevents innenfor spennet av ukene vi viser, og bøtt per uke.
	let dayEvents: Array<{
		ts: Date;
		total: number;
		social: number;
		detailed: boolean;
		hourly: number[] | undefined;
	}> = [];
	let weekEvents: Array<{ ts: Date; apps: Record<string, number> | undefined }> = [];
	if (sensor && weekAggs.length > 0) {
		const oldest = weekAggs[weekAggs.length - 1];
		const earliest = isoWeekKeyToMonday(oldest.periodKey) ?? oldest.startDate;
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
				detailed: d.captureType === 'daily',
				hourly: hourlyArrayFromBuckets(d.hourly)
			};
		});
		weekEvents = wevents.map((e) => ({
			ts: e.timestamp,
			apps: (e.data as Record<string, any> | undefined)?.apps as Record<string, number> | undefined
		}));
	}

	const weeks = weekAggs.map((agg, idx) => {
		// Utled mandag fra periodKey ('2026W24') — lagret startDate kan være
		// tidssoneskjev (søndag kveld UTC) fra eldre aggregeringer.
		const start = isoWeekKeyToMonday(agg.periodKey) ?? agg.startDate;
		const end = new Date(
			start.getFullYear(),
			start.getMonth(),
			start.getDate() + 6,
			23,
			59,
			59,
			999
		);
		const metric = screenTimeMetricFromAggregate(agg)!;

		// Fast man–søn-array (7 slots), totaler fra dagsevents i ukens datointervall.
		const dayISOs: string[] = [];
		for (let i = 0; i < 7; i++) {
			const d = new Date(start);
			d.setDate(d.getDate() + i);
			dayISOs.push(toISODate(d));
		}
		const byDate = new Map<
			string,
			{ total: number; social: number; detailed: boolean; hourly: number[] | undefined }
		>();
		for (const ev of dayEvents) {
			if (ev.ts < start || ev.ts > end) continue;
			byDate.set(toISODate(ev.ts), {
				total: ev.total,
				social: ev.social,
				detailed: ev.detailed,
				hourly: ev.hourly
			});
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

		// Akkumulert ukeserie (man 00 → søn 24). Dager uten time-detalj fordeles
		// etter ukens timeprofil, ellers flatt over døgnet.
		const cumulativeSeries = buildCumulativeWeekSeries(
			dayISOs.map((iso) => {
				const hit = byDate.get(iso);
				return { totalMinutes: hit?.total ?? 0, hourly: hit?.hourly };
			}),
			metric.byHour
		);

		// Ukesoppsummering (apper) i ukens intervall → samme uke som resten.
		const weekEvent = weekEvents.find((w) => w.ts >= start && w.ts <= end);
		const topApps = weekEvent?.apps
			? Object.entries(weekEvent.apps)
					.map(([name, minutes]) => ({ name, minutes: Number(minutes) || 0 }))
					.sort((a, b) => b.minutes - a.minutes)
					.slice(0, 8)
			: [];

		// Mål evaluert mot denne uka vs. uka før (neste i desc-rekkefølge).
		const prevMetric = screenTimeMetricFromAggregate(weekAggs[idx + 1]);
		const goals = goalRecords.map((g) => evaluateScreenTimeGoal(g, metric, prevMetric));

		return {
			periodKey: agg.periodKey,
			weekStartISO: toISODate(start),
			label: weekLabel(start),
			hasWeekScreenshot: Boolean(weekEvent),
			metric,
			weekDays,
			cumulativeSeries,
			topApps,
			goals
		};
	});

	return {
		connected: Boolean(sensor),
		weeks,
		// Default = nyeste uke med data (der ferske dagsbilder / time-for-time
		// havner). Brukeren kan bla til en eldre, komplett uke med pilene.
		defaultIndex: 0,
		goalsForManagement,
		categoryLabels: SCREEN_TIME_CATEGORY_LABELS
	};
}

export type ScreenTimeDashboardPayload = Awaited<ReturnType<typeof loadScreenTimeDashboardData>>;
