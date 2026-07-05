import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	computeTrackStates,
	createDefaultPlan,
	evaluateAndMarkMilestones,
	getActivePlan,
	getMilestonesForTracks,
	setMilestoneAchieved
} from '$lib/server/tracks/repository';
import { buildAthleteSnapshot } from '$lib/server/programs/athlete-context';

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
	const milestones = await getMilestonesForTracks(trackIds);

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
	}
};
