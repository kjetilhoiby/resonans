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
import { db } from '$lib/db';
import { sensorAggregates, sensorEvents, sensors } from '$lib/db/schema';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';

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
export async function loadTrainingDashboardData(
	userId: string,
	opts: { evaluateMilestones?: boolean } = {}
) {
	// Belastningsserien er uavhengig av om et treningsløp finnes: form og
	// balanse er verdt å se også i oppsett-modus.
	const [plan, dailyEffort] = await Promise.all([getActivePlan(userId), loadDailyEffort(userId)]);

	if (!plan) {
		// Oppsett-modus: prefyll baseline fra det vi vet om utøveren
		const snapshot = await buildAthleteSnapshot(userId).catch(() => null);
		return {
			plan: null,
			states: null,
			milestones: [] as MilestoneView[],
			snapshot,
			dailyEffort,
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
		activities: activityDetail.activities,
		recentEvents: activityDetail.recentEvents
	};
}

export type TrainingDashboardPayload = Awaited<ReturnType<typeof loadTrainingDashboardData>>;
