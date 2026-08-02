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
	const plan = await getActivePlan(userId);
	if (!plan) {
		// Oppsett-modus: prefyll baseline fra det vi vet om utøveren
		const snapshot = await buildAthleteSnapshot(userId).catch(() => null);
		return { plan: null, states: null, milestones: [], snapshot };
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
	const [milestones, weightThreshold, routes] = await Promise.all([
		getMilestonesForTracks(trackIds),
		getLatestWeightThreshold(userId).catch(() => null),
		getRoutesWithEffort(userId, easyPace).catch(() => [])
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
		snapshot: null
	};
};

export type TrainingDashboardPayload = Awaited<ReturnType<typeof loadTrainingDashboardData>>;
