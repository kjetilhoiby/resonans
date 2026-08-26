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
	screenTimeMetricFromAggregate,
	type ScreenTimeMetric
} from '$lib/server/integrations/screen-time-goals';
import {
	buildCumulativeWeekSeries,
	categoryHourlyFromBuckets,
	hourlyArrayFromBuckets,
	toISODate,
	weekLabel
} from '$lib/utils/screen-time-series';
import { isoWeekKeyToMonday } from '$lib/server/integrations/time-periods';
import { readScreenTimeSettings } from '$lib/server/health/screen-time-settings';
import {
	buildAttentionDays,
	buildWeekAttention,
	type AttentionDay,
	type WeekAttention
} from '$lib/domain/health/screen-time-attention';

/**
 * Skjermtid-dashboardet: uker med dagsfordeling, akkumulert serie, topp-apper
 * og målevaluering. Deles av /skjermtid-ruten og Skjermtid-undertemaet
 * (/api/tema/[id]/dashboard/screentime), så begge viser nøyaktig samme bilde.
 *
 * Ren lesing — opplasting og parsing av skjermbilder bor i
 * /api/sensors/screen-time/*.
 *
 * Skiller **skjermtid** (det iOS rapporterte) fra **oppmerksomhet** (det som står
 * igjen når passive timer og ignorerte apper er trukket fra). Beregningen bor i
 * `$lib/domain/health/screen-time-attention.ts` og gjøres her, ved LESING —
 * bevisst ikke lagret i `sensor_aggregates`: legger brukeren en app i
 * ignoreringslista, skal historikken endres med, uten en reberegningsjobb. Samme
 * felle som lagret `effortScore`, se CLAUDE.md.
 */
export async function loadScreenTimeDashboardData(userId: string) {
	const [sensor, settings] = await Promise.all([
		db.query.sensors.findFirst({
			columns: { id: true },
			where: and(eq(sensors.provider, 'screen_time'), eq(sensors.userId, userId))
		}),
		readScreenTimeSettings(userId)
	]);

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
		dateISO: string;
		total: number;
		social: number;
		detailed: boolean;
		hourly: number[] | undefined;
		socialHourly: number[] | undefined;
		apps: Record<string, number> | undefined;
	}> = [];
	let weekEvents: Array<{ ts: Date; apps: Record<string, number> | undefined }> = [];
	if (sensor && weekAggs.length > 0) {
		const oldest = weekAggs[weekAggs.length - 1];
		const earliest = isoWeekKeyToMonday(oldest.periodKey) ?? oldest.startDate;
		// Én dag ekstra bakover: den eldste mandagens natt skjøtes mot søndagen før
		// (se `buildAttentionDays`). Dagen faller uansett utenfor ukebøttene.
		const earliestWithMargin = new Date(earliest.getTime() - 86400000);
		const [days, wevents] = await Promise.all([
			db.query.sensorEvents.findMany({
				where: and(
					eq(sensorEvents.sensorId, sensor.id),
					eq(sensorEvents.dataType, SCREEN_TIME_DATATYPE),
					gte(sensorEvents.timestamp, earliestWithMargin)
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
				dateISO: toISODate(e.timestamp),
				total: typeof d.totalMinutes === 'number' ? d.totalMinutes : 0,
				social: typeof d.categories?.social === 'number' ? d.categories.social : 0,
				detailed: d.captureType === 'daily',
				hourly: hourlyArrayFromBuckets(d.hourly),
				socialHourly: categoryHourlyFromBuckets(d.hourly, 'social'),
				apps: d.apps as Record<string, number> | undefined
			};
		});
		weekEvents = wevents.map((e) => ({
			ts: e.timestamp,
			apps: (e.data as Record<string, any> | undefined)?.apps as Record<string, number> | undefined
		}));
	}

	// Oppmerksomhetstid per dag, beregnet over HELE spennet i én omgang slik at
	// nattas rekke kan skjøtes over både midnatt og ukeskiftet.
	const attentionByDate = new Map<string, AttentionDay>(
		buildAttentionDays(
			dayEvents.map((e) => ({
				dateISO: e.dateISO,
				totalMinutes: e.total,
				socialMinutes: e.social,
				hourly: e.hourly,
				socialHourly: e.socialHourly,
				apps: e.apps
			})),
			settings
		).map((d) => [d.dateISO, d])
	);

	const weeks = weekAggs.map((agg) => {
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
			byDate.set(ev.dateISO, {
				total: ev.total,
				social: ev.social,
				detailed: ev.detailed,
				hourly: ev.hourly
			});
		}

		const attentionDays = dayISOs
			.map((iso) => attentionByDate.get(iso))
			.filter((d): d is AttentionDay => Boolean(d) && byDate.has(d!.dateISO));

		const weekDays = dayISOs.map((iso) => {
			const hit = byDate.get(iso);
			const att = attentionByDate.get(iso);
			return {
				date: iso,
				totalMinutes: hit?.total ?? 0,
				socialMinutes: hit?.social ?? 0,
				detailed: hit?.detailed ?? false,
				attentionMinutes: hit ? att?.attentionMinutes ?? hit.total : 0,
				passiveMinutes: hit ? att?.passiveMinutes ?? 0 : 0,
				ignoredAppMinutes: hit ? att?.ignoredAppMinutes ?? 0 : 0,
				hasHourly: Boolean(att?.hasHourly)
			};
		});

		const attention = buildWeekAttention(metric, attentionDays, settings);

		// Akkumulert ukeserie (man 00 → søn 24). Dager uten time-detalj fordeles
		// etter ukens timeprofil, ellers flatt over døgnet.
		//
		// BEGGE grunnlag sendes med. Grafen må følge samme filtrering som tallet
		// over den — ellers motsier flaten seg selv — og siden brukeren kan veksle
		// mellom «Oppmerksomhet» og «Slik iOS teller», må klienten ha begge seriene.
		// Med bare den ene ville toggelen endret overskriften og latt grafen stå.
		const cumulativeRawSeries = buildCumulativeWeekSeries(
			dayISOs.map((iso) => {
				const hit = byDate.get(iso);
				return hit ? { totalMinutes: hit.total, hourly: hit.hourly } : { totalMinutes: 0 };
			}),
			metric.byHour
		);
		const cumulativeSeries = attention.enabled
			? buildCumulativeWeekSeries(
					dayISOs.map((iso) => {
						const hit = byDate.get(iso);
						if (!hit) return { totalMinutes: 0 };
						const att = attentionByDate.get(iso);
						return att
							? { totalMinutes: att.attentionMinutes, hourly: att.attentionHourly }
							: { totalMinutes: hit.total, hourly: hit.hourly };
					}),
					attention.byHour
				)
			: cumulativeRawSeries;

		// Ukesoppsummering (apper) i ukens intervall → samme uke som resten.
		const weekEvent = weekEvents.find((w) => w.ts >= start && w.ts <= end);
		const topApps = weekEvent?.apps
			? Object.entries(weekEvent.apps)
					.map(([name, minutes]) => ({ name, minutes: Number(minutes) || 0 }))
					.sort((a, b) => b.minutes - a.minutes)
					.slice(0, 8)
			: [];

		return {
			periodKey: agg.periodKey,
			weekStartISO: toISODate(start),
			label: weekLabel(start),
			hasWeekScreenshot: Boolean(weekEvent),
			metric,
			attention,
			weekDays,
			cumulativeSeries,
			cumulativeRawSeries,
			topApps,
			goals: [] as ReturnType<typeof evaluateScreenTimeGoal>[]
		};
	});

	// Mål evalueres etterpå, når hver uke har sin egen filtrerte metrikk: både
	// denne uka og uka før må måles på SAMME grunnlag, ellers ser filtreringen
	// ut som en forbedring fra forrige uke.
	for (let idx = 0; idx < weeks.length; idx++) {
		const basis = goalMetric(weeks[idx].metric, weeks[idx].attention);
		const prev = weeks[idx + 1] ? goalMetric(weeks[idx + 1].metric, weeks[idx + 1].attention) : null;
		weeks[idx].goals = goalRecords.map((g) => evaluateScreenTimeGoal(g, basis, prev));
	}

	// Appnavn brukeren kan velge å ignorere: alt vi har sett i vinduet, største først.
	const appTotals = new Map<string, { name: string; minutes: number }>();
	for (const source of [...weekEvents.map((w) => w.apps), ...dayEvents.map((d) => d.apps)]) {
		if (!source) continue;
		for (const [name, minutes] of Object.entries(source)) {
			const m = Number(minutes) || 0;
			const key = name.trim().toLowerCase();
			if (!key) continue;
			const hit = appTotals.get(key);
			if (hit) hit.minutes = Math.max(hit.minutes, m);
			else appTotals.set(key, { name: name.trim(), minutes: m });
		}
	}
	const knownApps = [...appTotals.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 30);

	return {
		connected: Boolean(sensor),
		weeks,
		// Default = nyeste uke med data (der ferske dagsbilder / time-for-time
		// havner). Brukeren kan bla til en eldre, komplett uke med pilene.
		defaultIndex: 0,
		goalsForManagement,
		categoryLabels: SCREEN_TIME_CATEGORY_LABELS,
		settings,
		knownApps
	};
}

/**
 * Metrikken målene evalueres mot: den filtrerte når filtreringen er på, ellers
 * iOS' egen. Et mål om «under 4t skjermtid» skal måles på det brukeren faktisk
 * brukte skjermen til — men bare timeprofilen er filtrert, så `byHour` og
 * `socialByHour` byttes ut sammen med totalene, aldri halvparten av dem.
 */
function goalMetric(metric: ScreenTimeMetric, attention: WeekAttention): ScreenTimeMetric {
	if (!attention.enabled) return metric;
	return {
		...metric,
		totalMinutes: attention.attentionMinutes,
		avgPerDayMinutes: attention.avgPerDayMinutes,
		socialMinutes: attention.attentionSocialMinutes,
		socialAvgPerDayMinutes: attention.socialAvgPerDayMinutes,
		byHour: attention.byHour,
		socialByHour: attention.socialByHour
	};
}

export type ScreenTimeDashboardPayload = Awaited<ReturnType<typeof loadScreenTimeDashboardData>>;
