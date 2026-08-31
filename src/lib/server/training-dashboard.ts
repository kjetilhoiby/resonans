import {
	computeTrackStates,
	evaluateAndMarkMilestones,
	getActivePlan,
	getLatestWeightThreshold,
	getMilestonesForTracks
} from '$lib/server/tracks/repository';
import { buildAthleteSnapshot } from '$lib/server/programs/athlete-context';
import {
	buildWeekPlanExamples,
	composeWeekRecipe,
	pickBoostSuggestion,
	projectWeekEffort,
	summarizeWeekSessions
} from '$lib/server/tracks/effort-budget';
import { getRoutesWithEffort } from '$lib/server/tracks/routes-repository';
import { buildUnifiedWorkoutActivities } from '$lib/server/activity-layer';
import { mapDailyEffortSeries } from '$lib/domain/health/daily-effort';
import { pickVo2maxMetric, type Vo2maxSample } from '$lib/domain/health/vo2max';
import {
	efficiencySeries,
	efficiencyTrend,
	type EfficiencySession
} from '$lib/domain/health/aerobic-efficiency';
import { distanceRecords, type RecordWorkout } from '$lib/domain/health/distance-records';
import { pickHrRecoveryMetric, type HrRecoverySample } from '$lib/domain/health/hr-recovery';
import { averagePaceSecPerKm, estimateVdotFromBestEfforts } from '$lib/server/workouts/vdot';
import { db } from '$lib/db';
import { canonicalWorkouts, sensorAggregates, sensorEvents, sensors } from '$lib/db/schema';
import { and, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { loadRunningHistory } from '$lib/server/training/running-history';
import { osloDayKey } from '$lib/domain/oslo-time';
import { loadVolumeAndQuality } from '$lib/server/training/volume-quality';
import { getEffortBaseline } from '$lib/server/services/effort-service';

/**
 * EF-historikk. Må dekke sammenligningsvinduet (8 uker tilbake pluss 28 dagers
 * vindu) med god margin, ellers blir «for to måneder siden» tomt.
 */
const EF_HISTORY_DAYS = 240;

// Dekker 365d-vinduet i aktivitetslista.
const WORKOUT_LOOKBACK_DAYS = 400;

// Form-kortet viser 120 dagers vindu; CTL trenger innsvingning før det.
const DAILY_EFFORT_DAYS = 400;

/**
 * Daglig effort, som mater form- og belastningskortene (CTL/ATL/TSB).
 *
 * Bodde på helse-mortemaet fram til august 2026. Flyttet hit sammen med
 * kortene: treningsbelastning er trening. Mortemaet viser sammenhengen
 * gjennom signalene i stedet, og sparer samtidig denne spørringen.
 */
async function loadDailyEffort(userId: string) {
	const rows = await db.query.sensorAggregates.findMany({
		columns: { periodKey: true, metrics: true },
		where: and(eq(sensorAggregates.userId, userId), eq(sensorAggregates.period, 'day')),
		orderBy: [desc(sensorAggregates.startDate)],
		limit: DAILY_EFFORT_DAYS
	});
	return mapDailyEffortSeries(rows);
}

// Rullende vindu for formgulvet. Åtte uker: langt nok til at en uke uten hard
// løping ikke ser ut som et formfall, kort nok til at det fortsatt er «nå».
const VO2MAX_WINDOW_DAYS = 56;

/**
 * Pulsfall har et kortere vindu enn VO2max: det svinger med restitusjon og
 * belastning på ukesskala, mens oksygenopptak flytter seg over måneder. Fire uker
 * er nok til å finne en hard økt uten å vise et tall fra en annen treningsperiode.
 */
const HR_RECOVERY_WINDOW_DAYS = 28;

/**
 * VO2max: Withings-måling der den finnes, ellers VDOT fra løpenes best-efforts.
 *
 * Leses rett fra kildene framfor fra ukesaggregatet, av samme grunn som dagens
 * ernæringstall: det er ferskt rett etter en økt, og det slipper å vente på
 * neste cron-kjøring. Aggregatet finnes for historikk og AI-kontekst.
 */
async function loadVo2max(userId: string) {
	const since = new Date(Date.now() - VO2MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000);

	const [runs, measured] = await Promise.all([
		db.query.canonicalWorkouts.findMany({
			where: and(
				eq(canonicalWorkouts.userId, userId),
				gte(canonicalWorkouts.startTime, since)
			),
			columns: {
			startTime: true,
			bestEfforts: true,
			distanceMeters: true,
			durationSeconds: true,
			gapSecPerKm: true
		}
		}),
		db.query.sensorEvents.findMany({
			where: and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'vo2max'),
				gte(sensorEvents.timestamp, since)
			),
			columns: { timestamp: true, data: true }
		})
	]);

	const samples: Vo2maxSample[] = [];

	for (const event of measured) {
		const value = (event.data as { vo2max?: unknown } | null)?.vo2max;
		if (typeof value !== 'number') continue;
		samples.push({ value, at: event.timestamp.toISOString(), source: 'withings' });
	}

	for (const run of runs) {
		if (!run.bestEfforts) continue;
		// Stigningsjustering: gapSecPerKm har ligget her hele tiden uten å bli brukt,
		// og en fadende motbakketur gir ellers en VDOT som er for lav.
		const rawPace = averagePaceSecPerKm(
			run.distanceMeters ? Number(run.distanceMeters) : null,
			run.durationSeconds ? Number(run.durationSeconds) : null
		);
		const gap = run.gapSecPerKm ? Number(run.gapSecPerKm) : null;
		const estimate = estimateVdotFromBestEfforts(
			run.bestEfforts,
			gap !== null && rawPace !== null ? { gapSecPerKm: gap, rawPaceSecPerKm: rawPace } : null
		);
		if (!estimate) continue;
		samples.push({
			value: estimate.vdot,
			at: run.startTime.toISOString(),
			source: 'best_efforts',
			sourceDistance: estimate.sourceDistance
		});
	}

	return pickVo2maxMetric(samples);
}

/**
 * Beste pulsfall siste fire uker, lest fra `hr_recovery`-hendelsene.
 *
 * Beregningen skjer i Withings-synken, siden den krever intraday-pulsserien —
 * her er det bare oppsummering. Leses fra kilden framfor fra ukesaggregatet av
 * samme grunn som VO2max: det skal være ferskt rett etter en økt.
 */
async function loadHrRecovery(userId: string) {
	const since = new Date(Date.now() - HR_RECOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

	const events = await db.query.sensorEvents.findMany({
		where: and(
			eq(sensorEvents.userId, userId),
			eq(sensorEvents.dataType, 'hr_recovery'),
			gte(sensorEvents.timestamp, since)
		),
		columns: { timestamp: true, data: true }
	});

	const samples: HrRecoverySample[] = [];
	for (const event of events) {
		const data = (event.data ?? {}) as Record<string, unknown>;
		if (typeof data.dropBpm !== 'number') continue;
		samples.push({
			dropBpm: data.dropBpm,
			at: event.timestamp.toISOString(),
			endBpm: typeof data.endBpm === 'number' ? data.endBpm : 0,
			peakBpm: typeof data.peakBpm === 'number' ? data.peakBpm : 0,
			anchorOffsetSeconds:
				typeof data.anchorOffsetSeconds === 'number' ? data.anchorOffsetSeconds : 0,
			spanSeconds: typeof data.spanSeconds === 'number' ? data.spanSeconds : 60,
			sportFamily: typeof data.sportFamily === 'string' ? data.sportFamily : undefined
		});
	}

	return pickHrRecoveryMetric(samples);
}

/**
 * Aktivitetslaget og rå treningshendelser. Bodde på helse-dashboardet fram til
 * mortema-splitten; de er per-økt-detaljer og hører til Trening.
 */
interface MilestoneView {
	id: string;
	trackId: string;
	name: string;
	achievedAt: string | null;
	manual: boolean;
}

type ActivityDetail = Awaited<ReturnType<typeof loadActivityDetail>>;

async function loadActivityDetail(userId: string) {
	const [workouts, healthSensors] = await Promise.all([
		buildUnifiedWorkoutActivities(userId, {
			since: new Date(Date.now() - 1000 * 60 * 60 * 24 * WORKOUT_LOOKBACK_DAYS),
			limit: 2000
		}),
		db.query.sensors.findMany({
			columns: { id: true },
			where: and(
				eq(sensors.userId, userId),
				or(eq(sensors.type, 'health_tracker'), eq(sensors.type, 'workout_files'))
			)
		})
	]);

	const sensorIds = healthSensors.map((s) => s.id);
	const events = sensorIds.length
		? await db
				.select({
					id: sensorEvents.id,
					timestamp: sensorEvents.timestamp,
					dataType: sensorEvents.dataType,
					data: sql<Record<string, unknown>>`${sensorEvents.data} - 'trackPoints' - 'rawResponse' - 'laps' - 'samples'`
				})
				.from(sensorEvents)
				.where(and(eq(sensorEvents.userId, userId), inArray(sensorEvents.sensorId, sensorIds)))
				.orderBy(desc(sensorEvents.timestamp))
				.limit(100)
		: [];

	return {
		activities: workouts,
		recentEvents: events.map((event) => ({
			id: event.id,
			timestamp: event.timestamp.toISOString(),
			dataType: event.dataType ?? 'ukjent',
			data: event.data ?? {}
		}))
	};
}

/**
 * Trenings-dashboardet: aktivt treningsløp, ukesbudsjett, balanse, ruter og
 * milepæler. Deles av /trening-ruten og Trening-undertemaet
 * (/api/tema/[id]/dashboard/training).
 *
 * NB: ren lesing som standard. Milepæl-evaluering skriver til databasen og må
 * derfor bes om eksplisitt — dashboard-endepunktet gjør det ikke.
 */
/**
 * Efficiency Factor: fart per hjerteslag, bakkekorrigert.
 *
 * Svarer på «ligger puls/fart-kurven flatere nå enn før» — det VO2max ikke gjør,
 * fordi VDOT antar maksimal innsats og denne brukeren ikke racer. Se
 * `$lib/domain/health/aerobic-efficiency.ts`.
 *
 * Leses fra `canonical_workouts`, som alt har `gapSecPerKm` og
 * `hrZoneDistribution` — ingen nye data trengs.
 */
async function loadAerobicEfficiency(userId: string) {
	const since = new Date(Date.now() - EF_HISTORY_DAYS * 24 * 60 * 60 * 1000);
	const rows = await db.query.canonicalWorkouts.findMany({
		where: and(eq(canonicalWorkouts.userId, userId), gte(canonicalWorkouts.startTime, since)),
		columns: {
			startTime: true,
			sportFamily: true,
			gapSecPerKm: true,
			avgHeartRate: true,
			durationSeconds: true,
			hrZoneDistribution: true
		}
	});

	const sessions: EfficiencySession[] = rows.map((row) => {
		const zones = row.hrZoneDistribution as { z4?: number; z5?: number } | null;
		return {
			startTime: row.startTime,
			sportFamily: row.sportFamily,
			gapSecPerKm: row.gapSecPerKm != null ? Number(row.gapSecPerKm) : null,
			avgHeartRate: row.avgHeartRate != null ? Number(row.avgHeartRate) : null,
			durationSeconds: row.durationSeconds != null ? Number(row.durationSeconds) : null,
			// Andel av tida i sone 4–5 skiller en jevn økt fra en intervalløkt.
			hardShare: zones ? (zones.z4 ?? 0) + (zones.z5 ?? 0) : null
		};
	});

	const points = efficiencySeries(sessions);
	return {
		points: points.map((p) => ({ date: p.date.toISOString(), ef: Math.round(p.ef * 1000) / 1000 })),
		trend: efficiencyTrend(points, new Date())
	};
}

/**
 * Distanserekorder: beste tid per distanse over hele historikken.
 *
 * `bestEfforts` har vært regnet og lagret på hver økt hele tiden, men bare brukt
 * til VDOT-estimering — ingen flate viste dem. Se
 * `$lib/domain/health/distance-records.ts`.
 */
async function loadDistanceRecords(userId: string) {
	// Ingen datogrense: en rekord er en rekord uansett hvor gammel den er, og et
	// vindu ville gjort at den forsvant fra lista den dagen den ble for gammel.
	const rows = await db.query.canonicalWorkouts.findMany({
		where: eq(canonicalWorkouts.userId, userId),
		columns: { id: true, startTime: true, sportFamily: true, bestEfforts: true }
	});

	const workouts: RecordWorkout[] = rows.map((row) => ({
		activityId: row.id,
		startTime: row.startTime,
		sportFamily: row.sportFamily,
		bestEfforts: (row.bestEfforts as Partial<Record<string, number>> | null) ?? null
	}));

	return distanceRecords(workouts).map((r) => ({
		key: r.key,
		label: r.label,
		seconds: r.seconds,
		date: r.date.toISOString()
	}));
}

export async function loadTrainingDashboardData(
	userId: string,
	opts: { evaluateMilestones?: boolean } = {}
) {
	// Belastningsserien er uavhengig av om et treningsløp finnes: form og
	// balanse er verdt å se også i oppsett-modus.
	const [
		plan,
		dailyEffort,
		vo2max,
		hrRecovery,
		aerobicEfficiency,
		distanceRecordList,
		runningHistory,
		volumeQuality,
		hrBaselineRaw
	] = await Promise.all([
		getActivePlan(userId),
		loadDailyEffort(userId),
		loadVo2max(userId).catch(() => null),
		loadHrRecovery(userId).catch(() => null),
		loadAerobicEfficiency(userId).catch(() => null),
		loadDistanceRecords(userId).catch(() => []),
		// Egen spørring, ikke aktivitetslista: den leser 400 dager, og år mot år
		// trenger år. Se `running-history.ts`.
		loadRunningHistory(userId).catch(() => ({
			days: [],
			firstDay: null,
			today: osloDayKey(new Date())
		})),
		// Slepende volum + sonesammensetning. Samme laster som widgetdetaljen og
		// `query_training` bruker — tre flater, ett svar.
		loadVolumeAndQuality(userId).catch(() => null),
		// Pulsfordelingen i aktivitetslista tegnes mot brukerens egne sonebånd.
		getEffortBaseline(userId).catch(() => null)
	]);

	if (!plan) {
		// Oppsett-modus: prefyll baseline fra det vi vet om utøveren
		const snapshot = await buildAthleteSnapshot(userId).catch(() => null);
		return {
			plan: null,
			states: null,
			milestones: [] as MilestoneView[],
			snapshot,
			dailyEffort,
			vo2max,
			hrRecovery,
			aerobicEfficiency,
			distanceRecords: distanceRecordList,
			runningHistory,
			volumeQuality,
			hrBaseline: hrBaselineRaw
				? { restHr: hrBaselineRaw.restHr, maxHr: hrBaselineRaw.maxHr }
				: null,
			activities: [] as ActivityDetail['activities'],
			recentEvents: [] as ActivityDetail['recentEvents']
		};
	}

	const states = await computeTrackStates(userId, plan);

	if (opts.evaluateMilestones) {
		// Auto-merk milepæler nådd av faktiske registreringer.
		await evaluateAndMarkMilestones(userId, states).catch((err) =>
			console.error('[trening] milepæl-evaluering feilet', err)
		);
	}

	const trackIds = [states.styrkeTrack?.id, states.utholdenhetTrack?.id].filter((id): id is string => !!id);
	// Referanse-pace for rute-effort: faktisk snitt siste 14 dager, ellers kurve
	const easyPace =
		states.enduranceState?.sistePaceSekPerKm ?? states.enduranceState?.forventetPaceSekPerKm ?? null;
	const [milestones, weightThreshold, routes, activityDetail] = await Promise.all([
		getMilestonesForTracks(trackIds),
		getLatestWeightThreshold(userId).catch(() => null),
		getRoutesWithEffort(userId, easyPace).catch(() => []),
		loadActivityDetail(userId)
	]);

	const today = new Date().toISOString().slice(0, 10);
	const planExamples =
		states.budget && states.enduranceState
			? buildWeekPlanExamples(
					states.enduranceState.forventetPaceSekPerKm,
					states.budget.bandMin,
					states.budget.bandMax
				)
			: [];

	// Ukesprognose: forbrukt + det du vanligvis gjør resten av uka.
	// «Grøfta» = under både bandMin (regresjon) og vekt-terskelen (når den finnes).
	const projection = states.budget ? projectWeekEffort(states.enduranceWorkouts, today) : null;
	const referenceTarget = Math.max(
		states.budget?.bandMin ?? 0,
		weightThreshold?.thresholdEffort ?? 0
	);
	const boost =
		projection && referenceTarget > 0
			? pickBoostSuggestion(referenceTarget - projection.projectedTotal, planExamples)
			: null;

	// Konkret øktoppskrift som tetter gjenstående effort («Rolig 8 km + Intervaller 30 min»).
	// Belønn variasjon: når løp dominerer miksen (≥ 60 %), vektes oppskriften mot
	// kryss-trening for balanse — km-målet fanger fortsatt løpsbehovet separat.
	const runHeavy =
		(states.balance?.disciplines[0]?.family === 'running' &&
			(states.balance?.disciplines[0]?.pct ?? 0) >= 60) ??
		false;
	const weekRecipe =
		states.budget && states.enduranceState
			? composeWeekRecipe(
					states.budget.remainingMin,
					states.budget.remainingMax,
					states.enduranceState.forventetPaceSekPerKm,
					{ preferVariety: runHeavy }
				)
			: null;

	return {
		plan: {
			id: plan.id,
			name: plan.name,
			startDate: plan.startDate,
			durationWeeks: plan.durationWeeks
		},
		states: {
			todayOwner: states.todayOwner,
			todaySuggestion: states.todaySuggestion,
			restReason: states.restReason,
			budget: states.budget,
			balance: states.balance,
			effortComposition: states.effortComposition,
			weekSessions: summarizeWeekSessions(states.enduranceWorkouts, today),
			planExamples,
			weightThreshold,
			projection,
			boost,
			weekRecipe,
			routes,
			todayCompleted: states.todayCompleted
				? {
						name: states.todayCompleted.payload.name,
						kind: states.todayCompleted.kind,
						actuals: states.todayCompleted.actuals
					}
				: null,
			strengthSuggestion: states.strengthSuggestion,
			strength: states.strengthState,
			endurance: states.enduranceState,
			styrkeTrackId: states.styrkeTrack?.id ?? null,
			utholdenhetTrackId: states.utholdenhetTrack?.id ?? null,
			styrkeGoal: states.styrkeTrack?.goal ?? null,
			utholdenhetGoal: states.utholdenhetTrack?.goal ?? null,
			targetDate: states.styrkeTrack?.targetDate ?? states.utholdenhetTrack?.targetDate ?? null,
			recentStrengthSessions: states.strengthSessions.slice(-6).reverse(),
			recentEnduranceWorkouts: states.enduranceWorkouts.slice(-10).reverse()
		},
		milestones: milestones.map((m) => ({
			id: m.id,
			trackId: m.trackId,
			name: m.name,
			achievedAt: m.achievedAt?.toISOString() ?? null,
			manual: m.criteria.manual ?? false
		})),
		snapshot: null,
		dailyEffort,
		vo2max,
		hrRecovery,
		aerobicEfficiency,
		distanceRecords: distanceRecordList,
		runningHistory,
		volumeQuality,
		hrBaseline: hrBaselineRaw
			? { restHr: hrBaselineRaw.restHr, maxHr: hrBaselineRaw.maxHr }
			: null,
		activities: activityDetail.activities,
		recentEvents: activityDetail.recentEvents
	};
}

export type TrainingDashboardPayload = Awaited<ReturnType<typeof loadTrainingDashboardData>>;
