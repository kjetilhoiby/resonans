import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	computeTrackStates,
	createDefaultPlan,
	evaluateAndMarkMilestones,
	getActivePlan,
	getLatestWeightThreshold,
	getMilestonesForTracks,
	setMilestoneAchieved
} from '$lib/server/tracks/repository';
import { buildAthleteSnapshot } from '$lib/server/programs/athlete-context';
import {
	buildWeekPlanExamples,
	composeWeekRecipe,
	pickBoostSuggestion,
	projectWeekEffort,
	summarizeWeekSessions
} from '$lib/server/tracks/effort-budget';
import { createRoute, getRoutesWithEffort } from '$lib/server/tracks/routes-repository';
import type { RouteKind, RouteVariant } from '$lib/server/tracks/routes';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) {
		return { plan: null, states: null, milestones: [], snapshot: null };
	}

	const plan = await getActivePlan(userId);
	if (!plan) {
		// Oppsett-modus: prefyll baseline fra det vi vet om utøveren
		const snapshot = await buildAthleteSnapshot(userId).catch(() => null);
		return { plan: null, states: null, milestones: [], snapshot };
	}

	const states = await computeTrackStates(userId, plan);
	// Auto-merk milepæler nådd av faktiske registreringer
	await evaluateAndMarkMilestones(userId, states).catch((err) =>
		console.error('[trening] milepæl-evaluering feilet', err)
	);
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

	// Konkret øktoppskrift som tetter gjenstående effort («Rolig 8 km + Intervaller 30 min»)
	const weekRecipe =
		states.budget && states.enduranceState
			? composeWeekRecipe(
					states.budget.remainingMin,
					states.budget.remainingMax,
					states.enduranceState.forventetPaceSekPerKm
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

export const actions: Actions = {
	opprett: async ({ locals, request }) => {
		const userId = locals.userId;
		if (!userId) return fail(401, { error: 'Ikke autentisert' });

		const form = await request.formData();
		const num = (key: string): number | undefined => {
			const value = Number(form.get(key));
			return Number.isFinite(value) && value > 0 ? value : undefined;
		};

		await createDefaultPlan(userId, {
			strengthBaseline: {
				armhevingerPerOkt: num('armhevinger'),
				plankeSekunder: num('planke'),
				pullupNegativSekunder: num('pullupNegativ')
			},
			enduranceBaseline: {
				ukesKm: num('ukesKm'),
				paceSekPerKm: num('paceSek')
			}
		});
		return { success: true };
	},

	milepael: async ({ locals, request }) => {
		const userId = locals.userId;
		if (!userId) return fail(401, { error: 'Ikke autentisert' });

		const form = await request.formData();
		const milestoneId = String(form.get('milestoneId') ?? '');
		const achieved = String(form.get('achieved') ?? '') === 'true';
		if (!milestoneId) return fail(400, { error: 'Mangler milestoneId' });

		const ok = await setMilestoneAchieved(userId, milestoneId, achieved);
		if (!ok) return fail(404, { error: 'Milepæl ikke funnet' });
		return { success: true };
	},

	nyrute: async ({ locals, request }) => {
		const userId = locals.userId;
		if (!userId) return fail(401, { error: 'Ikke autentisert' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const kind = String(form.get('kind') ?? 'run') as RouteKind;
		if (!name) return fail(400, { error: 'Mangler navn' });

		const num = (key: string): number | undefined => {
			const v = Number(form.get(key));
			return Number.isFinite(v) && v > 0 ? v : undefined;
		};
		const paceFromText = (mmss: string): number | undefined => {
			const m = mmss.trim().match(/^(\d{1,2}):(\d{2})$/);
			if (!m) return undefined;
			return Number(m[1]) * 60 + Number(m[2]);
		};

		// Enkel variant-modell fra skjema: opptil tre navngitte fartsvarianter
		const variants: RouteVariant[] = [];
		if (kind === 'bike') {
			variants.push({ label: 'Sykkel', family: 'cycling' }, { label: 'El-sykkel', family: 'ebike' });
		} else if (kind === 'hill') {
			const reps = num('reps') ?? 10;
			const repDist = num('repDistanceMeters') ?? 200;
			variants.push({ label: `${reps} × ${repDist} m`, reps, repDistanceMeters: repDist, paceSecPerKm: 300 });
		} else {
			for (const label of ['Rolig', 'Moderat', 'Terskel']) {
				const pace = paceFromText(String(form.get(`pace_${label}`) ?? ''));
				if (pace) variants.push({ label, paceSecPerKm: pace });
			}
			if (variants.length === 0) variants.push({ label: 'Jevnt' });
		}

		await createRoute(userId, {
			name,
			kind,
			distanceMeters: num('distanceKm') ? Math.round(num('distanceKm')! * 1000) : null,
			elevationMeters: num('elevationMeters') ?? null,
			terrain: (String(form.get('terrain') ?? '').trim() || null) as string | null,
			variants
		});
		return { success: true };
	}
};
