import type {
	PullupPhase,
	SessionSuggestion,
	StrengthGoal,
	StrengthSessionActual,
	StrengthSessionSummary,
	StrengthState,
	TrackWindow
} from './types';
import { ARMHEVINGER_NAME, PLANKE_NAME, PULLUP_NAME, PULLUP_NEGATIV_NAME } from './constants';
import { daysBetween, expectedAt } from './curve';

/**
 * Styrkemotoren: beregner tilstand og neste økt-targets fra faktiske
 * registreringer — aldri fra en pre-generert plan. Reglene er bevisst enkle:
 *
 *  - Armhevinger (total per økt): nesteTarget = min(mål, max(kurve(idag), besteAvSiste2 + 3)).
 *  - Planke (beste enkelthold):   nesteTarget = min(mål, max(kurve(idag), besteAvSiste2 + 5)).
 *  - Stall: de to siste øktene begge < 90 % av kurve-forventet på øktdatoen
 *    → nesteTarget = 90 % av siste faktiske (rebase i stedet for å jage kurven).
 *  - Pull-up: fasebasert — negativer +2 s per økt opp til 20 s, deretter strikte
 *    forsøk (reps). Fasen bestemmes av milepælene (drives utenfor motoren);
 *    her utledes den av om 20 s-negativer er nådd i registreringene.
 */

const ARMHEVINGER_INCREMENT = 3;
const PLANKE_INCREMENT_SEC = 5;
const PULLUP_NEGATIV_INCREMENT_SEC = 2;
const PULLUP_NEGATIV_MAX_SEC = 20;
const PULLUP_MAX_REPS = 3;
const STALL_RATIO = 0.9;
// Gjenopptrapping: opphold lengre enn dette siden siste økt → ikke jag kurven,
// start på en andel av siste faktiske (kroppen har mistet litt, bygg gradvis).
const COMEBACK_GAP_DAYS = 14;
const COMEBACK_FACTOR = 0.85;

function normalizeName(name: string): string {
	return name.trim().toLowerCase();
}

function isArmhevinger(name: string): boolean {
	const n = normalizeName(name);
	return n.includes('armheving') || n.includes('push-up') || n.includes('pushup') || n.includes('push up');
}

function isPlanke(name: string): boolean {
	const n = normalizeName(name);
	return n.includes('planke') || n.includes('plank');
}

function isPullupNegativ(name: string): boolean {
	const n = normalizeName(name);
	return n.includes('senking') || n.includes('negativ') || n.includes('eccentric');
}

function isPullup(name: string): boolean {
	const n = normalizeName(name);
	return (n.includes('pull-up') || n.includes('pullup') || n.includes('pull up')) && !isPullupNegativ(name);
}

/** Koker én økt ned til metrikkene løpet følger. */
export function summarizeStrengthSession(session: StrengthSessionActual): StrengthSessionSummary {
	let armhevingerTotal = 0;
	let plankeBestSeconds = 0;
	let pullupNegativBestSeconds = 0;
	let pullupNegativSets = 0;
	let pullupReps = 0;

	for (const exercise of session.exercises) {
		if (isArmhevinger(exercise.name)) {
			for (const set of exercise.sets) armhevingerTotal += set.reps ?? 0;
		} else if (isPlanke(exercise.name)) {
			for (const set of exercise.sets) {
				plankeBestSeconds = Math.max(plankeBestSeconds, set.durationSeconds ?? 0);
			}
		} else if (isPullupNegativ(exercise.name)) {
			for (const set of exercise.sets) {
				const sec = set.durationSeconds ?? 0;
				if (sec > 0) {
					pullupNegativSets += 1;
					pullupNegativBestSeconds = Math.max(pullupNegativBestSeconds, sec);
				}
			}
		} else if (isPullup(exercise.name)) {
			for (const set of exercise.sets) pullupReps = Math.max(pullupReps, set.reps ?? 0);
		}
	}

	return {
		date: session.date,
		armhevingerTotal,
		plankeBestSeconds,
		pullupNegativBestSeconds,
		pullupNegativSets,
		pullupReps
	};
}

function detectStall(
	summaries: StrengthSessionSummary[],
	metric: (s: StrengthSessionSummary) => number,
	curve: (date: string) => number
): boolean {
	const withValue = summaries.filter((s) => metric(s) > 0);
	if (withValue.length < 2) return false;
	const lastTwo = withValue.slice(-2);
	return lastTwo.every((s) => metric(s) < STALL_RATIO * curve(s.date));
}

/**
 * Beregner styrke-tilstanden fra de siste øktene (kronologisk, eldst først).
 */
export function computeStrengthState(
	sessions: StrengthSessionActual[],
	goal: StrengthGoal,
	window: TrackWindow,
	today: string
): StrengthState {
	const summaries = sessions.map(summarizeStrengthSession);

	// ── Armhevinger ──
	const armCurve = (date: string) =>
		expectedAt(goal.armhevinger.fra, goal.armhevinger.til, window.startDate, window.targetDate, date);
	const armValues = summaries.filter((s) => s.armhevingerTotal > 0);
	const armSiste = armValues.length > 0 ? armValues[armValues.length - 1].armhevingerTotal : null;
	const armLastDate = armValues.length > 0 ? armValues[armValues.length - 1].date : null;
	const armComeback = armLastDate != null && daysBetween(armLastDate, today) > COMEBACK_GAP_DAYS;
	const armBesteAvSiste2 = Math.max(0, ...armValues.slice(-2).map((s) => s.armhevingerTotal));
	const armStall = detectStall(summaries, (s) => s.armhevingerTotal, armCurve) && !armComeback;
	const armForventet = Math.round(armCurve(today));
	let armNesteTarget: number;
	if (armComeback && armSiste != null) {
		// Tilbake etter opphold: start på en andel av siste faktiske, ikke kurven.
		armNesteTarget = Math.min(goal.armhevinger.til, Math.max(goal.armhevinger.fra, Math.round(COMEBACK_FACTOR * armSiste)));
	} else if (armStall && armSiste != null) {
		armNesteTarget = Math.round(STALL_RATIO * armSiste);
	} else if (armValues.length === 0) {
		armNesteTarget = Math.min(goal.armhevinger.til, Math.max(goal.armhevinger.fra, armForventet));
	} else {
		armNesteTarget = Math.min(
			goal.armhevinger.til,
			Math.max(armForventet, armBesteAvSiste2 + ARMHEVINGER_INCREMENT)
		);
	}

	// ── Planke ──
	const plankeCurve = (date: string) =>
		expectedAt(goal.planke.fraSek, goal.planke.tilSek, window.startDate, window.targetDate, date);
	const plankeValues = summaries.filter((s) => s.plankeBestSeconds > 0);
	const plankeSiste = plankeValues.length > 0 ? plankeValues[plankeValues.length - 1].plankeBestSeconds : null;
	const plankeLastDate = plankeValues.length > 0 ? plankeValues[plankeValues.length - 1].date : null;
	const plankeComeback = plankeLastDate != null && daysBetween(plankeLastDate, today) > COMEBACK_GAP_DAYS;
	const plankeBesteAvSiste2 = Math.max(0, ...plankeValues.slice(-2).map((s) => s.plankeBestSeconds));
	const plankeStall = detectStall(summaries, (s) => s.plankeBestSeconds, plankeCurve) && !plankeComeback;
	const plankeForventet = Math.round(plankeCurve(today));
	let plankeNesteTarget: number;
	if (plankeComeback && plankeSiste != null) {
		plankeNesteTarget = Math.min(goal.planke.tilSek, Math.max(goal.planke.fraSek, Math.round(COMEBACK_FACTOR * plankeSiste)));
	} else if (plankeStall && plankeSiste != null) {
		plankeNesteTarget = Math.round(STALL_RATIO * plankeSiste);
	} else if (plankeValues.length === 0) {
		plankeNesteTarget = Math.min(goal.planke.tilSek, Math.max(goal.planke.fraSek, plankeForventet));
	} else {
		plankeNesteTarget = Math.min(
			goal.planke.tilSek,
			Math.max(plankeForventet, plankeBesteAvSiste2 + PLANKE_INCREMENT_SEC)
		);
	}

	// ── Pull-up (fasebasert) ──
	const negValues = summaries.filter((s) => s.pullupNegativBestSeconds > 0);
	const repsValues = summaries.filter((s) => s.pullupReps > 0);
	const sisteNegativ = negValues.length > 0 ? negValues[negValues.length - 1].pullupNegativBestSeconds : null;
	const sisteReps = repsValues.length > 0 ? repsValues[repsValues.length - 1].pullupReps : null;
	// Strikte-fasen: har registrert strikte reps, eller nådd 3 sett à 20 s negativer.
	const negativerFullfort = summaries.some(
		(s) => s.pullupNegativBestSeconds >= PULLUP_NEGATIV_MAX_SEC && s.pullupNegativSets >= 3
	);
	const fase: PullupPhase = sisteReps != null || negativerFullfort ? 'strikte' : 'negativer';
	const nesteTarget =
		fase === 'negativer'
			? {
					negativSek: Math.min(
						PULLUP_NEGATIV_MAX_SEC,
						Math.max(10, (sisteNegativ ?? 8) + PULLUP_NEGATIV_INCREMENT_SEC)
					)
				}
			: { reps: Math.min(PULLUP_MAX_REPS, Math.max(1, (sisteReps ?? 0) + 1)) };

	return {
		armhevinger: { siste: armSiste, forventet: armForventet, nesteTarget: armNesteTarget, stall: armStall, comeback: armComeback },
		planke: {
			sisteSek: plankeSiste,
			forventetSek: plankeForventet,
			nesteTargetSek: plankeNesteTarget,
			stall: plankeStall,
			comeback: plankeComeback
		},
		pullup: { fase, sisteNegativSek: sisteNegativ, sisteReps, nesteTarget }
	};
}

/** Bygger neste styrkeøkt fra tilstanden — ProgramSessionDTO-kompatible øvelser. */
export function nextStrengthSession(state: StrengthState): SessionSuggestion {
	const armSets = distributeReps(state.armhevinger.nesteTarget);
	const plannedExercises = [
		{
			order: 1,
			exerciseName: ARMHEVINGER_NAME,
			sets: armSets.sets,
			repsTarget: armSets.repsPerSet,
			notes: `Totalt ${state.armhevinger.nesteTarget} reps`
		},
		state.pullup.fase === 'negativer'
			? {
					order: 2,
					exerciseName: PULLUP_NEGATIV_NAME,
					sets: 3,
					durationSecondsTarget: state.pullup.nesteTarget.negativSek
				}
			: {
					order: 2,
					exerciseName: PULLUP_NAME,
					sets: 3,
					repsTarget: state.pullup.nesteTarget.reps
				},
		{
			order: 3,
			exerciseName: PLANKE_NAME,
			sets: 3,
			durationSecondsTarget: state.planke.nesteTargetSek
		}
	];

	return {
		kind: 'strength',
		name: 'Styrke',
		restSeconds: 90,
		plannedExercises,
		notes:
			state.armhevinger.comeback || state.planke.comeback
				? 'Tilbake etter opphold — targets satt fra siste økt. Bygg gradvis opp igjen.'
				: state.armhevinger.stall || state.planke.stall
					? 'Rolig uke — targets justert ned etter et par tunge økter.'
					: undefined
	};
}

/** Fordeler et total-reps-mål på sett (maks ~25 per sett, 3–8 sett). */
export function distributeReps(total: number): { sets: number; repsPerSet: number } {
	const sets = Math.min(8, Math.max(3, Math.ceil(total / 25)));
	return { sets, repsPerSet: Math.max(1, Math.ceil(total / sets)) };
}

/**
 * Sjekker hvilke milepæl-kriterier registreringene oppfyller.
 * Returnerer beste oppnådde verdi per metric.
 */
export function bestStrengthMetrics(sessions: StrengthSessionActual[]): Record<string, number> {
	const summaries = sessions.map(summarizeStrengthSession);
	const best: Record<string, number> = {
		armhevinger_total: 0,
		planke_sekunder: 0,
		pullup_negativ_sek: 0,
		pullup_reps: 0
	};
	for (const s of summaries) {
		best.armhevinger_total = Math.max(best.armhevinger_total, s.armhevingerTotal);
		best.planke_sekunder = Math.max(best.planke_sekunder, s.plankeBestSeconds);
		// Negativ-milepælene krever 3 sett på nivået — bruk beste sek kun når settkravet er møtt
		if (s.pullupNegativSets >= 3) {
			best.pullup_negativ_sek = Math.max(best.pullup_negativ_sek, s.pullupNegativBestSeconds);
		}
		best.pullup_reps = Math.max(best.pullup_reps, s.pullupReps);
	}
	return best;
}
