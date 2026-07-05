import type {
	EnduranceConfig,
	EnduranceGoal,
	EnduranceState,
	EnduranceWorkout,
	SessionSuggestion,
	TrackWindow
} from './types';
import { expectedAt, mondayOfDate, weekNumberAt } from './curve';

/**
 * Utholdenhetsmotoren: ukesvolum i løpsekvivalente km (eqKm) der sykkel og
 * el-sykkel teller med via effortScore, og pace-progresjon målt kun på løp.
 *
 *  - eqKm for ikke-løp = effortScore / effortPerRunKm, der effortPerRunKm er
 *    effort-kostnaden for 1 km løp i kurve-pace (pace-min/km × 2.5 — MET-
 *    faktoren for løping er 1.0). MET-vektene (cycling 0.85, ebike 0.4) gir
 *    dermed en allerede kalibrert vekting av sykkel mot løp.
 *  - Ikke-løp cappes til maksIkkeLopAndel av uketarget så pace-målet forblir
 *    løpsdrevet.
 *  - Uketarget følger kurven 14→22, hver deloadHverNteUke-uke × 0.8.
 *  - Stall: forrige uke < 70 % av target → target = min(kurve, forrigeUke × 1.1).
 */

const DELOAD_FACTOR = 0.8;
const STALL_RATIO = 0.7;
const STALL_REBASE_FACTOR = 1.1;
const MET_CALIBRATION = 2.5; // samme kalibrering som effort-service

export function isRunFamily(family: string): boolean {
	return family === 'running';
}

export function countsTowardEndurance(family: string): boolean {
	return family === 'running' || family === 'cycling' || family === 'ebike';
}

/** Effort-kostnaden for 1 km løp i gitt pace (sek/km). */
export function effortPerRunKm(paceSekPerKm: number): number {
	return (paceSekPerKm / 60) * MET_CALIBRATION;
}

export function curvePace(goal: EnduranceGoal, window: TrackWindow, date: string): number {
	return expectedAt(goal.paceSekPerKm.fra, goal.paceSekPerKm.til, window.startDate, window.targetDate, date);
}

export function curveWeekKm(
	goal: EnduranceGoal,
	config: EnduranceConfig,
	window: TrackWindow,
	date: string
): { targetKm: number; deload: boolean } {
	// Uketarget er konstant gjennom uka — kurven evalueres på ukens mandag.
	const monday = mondayOfDate(date);
	const base = expectedAt(goal.ukesKm.fra, goal.ukesKm.til, window.startDate, window.targetDate, monday);
	const weekNumber = weekNumberAt(window.startDate, monday);
	const deload = config.deloadHverNteUke > 0 && weekNumber % config.deloadHverNteUke === 0;
	return { targetKm: Math.round(base * (deload ? DELOAD_FACTOR : 1) * 10) / 10, deload };
}

function weekKeyOf(date: string): string {
	return mondayOfDate(date);
}

/** Summerer én ukes økter til (runKm, ikke-løp-eqKm før cap). */
function sumWeek(
	workouts: EnduranceWorkout[],
	paceForEq: number
): { runKm: number; nonRunEqKm: number } {
	let runKm = 0;
	let nonRunEqKm = 0;
	const perKm = effortPerRunKm(paceForEq);
	for (const w of workouts) {
		if (!countsTowardEndurance(w.family)) continue;
		if (isRunFamily(w.family)) {
			runKm += (w.distanceMeters ?? 0) / 1000;
		} else if (w.effortScore != null && w.effortScore > 0 && perKm > 0) {
			nonRunEqKm += w.effortScore / perKm;
		}
	}
	return { runKm, nonRunEqKm };
}

/**
 * Beregner utholdenhets-tilstanden for uken som inneholder `today`.
 * `workouts` er siste ~6 uker, kronologisk.
 */
export function computeEnduranceState(
	workouts: EnduranceWorkout[],
	goal: EnduranceGoal,
	config: EnduranceConfig,
	window: TrackWindow,
	today: string
): EnduranceState {
	const thisWeekKey = weekKeyOf(today);
	const pace = curvePace(goal, window, today);
	const { targetKm: curveTarget, deload } = curveWeekKm(goal, config, window, today);

	const byWeek = new Map<string, EnduranceWorkout[]>();
	for (const w of workouts) {
		const key = weekKeyOf(w.date);
		const list = byWeek.get(key) ?? [];
		list.push(w);
		byWeek.set(key, list);
	}

	// Forrige uke → stall-sjekk
	const prevMonday = new Date(`${thisWeekKey}T00:00:00Z`);
	prevMonday.setUTCDate(prevMonday.getUTCDate() - 7);
	const prevWeekKey = prevMonday.toISOString().slice(0, 10);
	const prevSums = sumWeek(byWeek.get(prevWeekKey) ?? [], pace);
	const prevCap = config.maksIkkeLopAndel * curveTarget;
	const prevTotal = prevSums.runKm + Math.min(prevSums.nonRunEqKm, prevCap);
	const { targetKm: prevCurveTarget } = curveWeekKm(goal, config, window, prevWeekKey);
	const hadPrevWeekData = (byWeek.get(prevWeekKey) ?? []).length > 0;
	const stallRebased = hadPrevWeekData && prevTotal < STALL_RATIO * prevCurveTarget;
	const weekTargetKm = stallRebased
		? Math.round(Math.min(curveTarget, prevTotal * STALL_REBASE_FACTOR) * 10) / 10
		: curveTarget;

	// Denne uken
	const thisSums = sumWeek(byWeek.get(thisWeekKey) ?? [], pace);
	const cap = config.maksIkkeLopAndel * weekTargetKm;
	const eqKmNonRun = Math.round(Math.min(thisSums.nonRunEqKm, cap) * 10) / 10;
	const runKm = Math.round(thisSums.runKm * 10) / 10;
	const totalEqKm = Math.round((runKm + eqKmNonRun) * 10) / 10;
	const remainingKm = Math.max(0, Math.round((weekTargetKm - totalEqKm) * 10) / 10);

	// Pace: snitt av løpeøkter siste 14 dager
	const cutoff = new Date(`${today}T00:00:00Z`);
	cutoff.setUTCDate(cutoff.getUTCDate() - 14);
	const cutoffIso = cutoff.toISOString().slice(0, 10);
	const recentRuns = workouts.filter(
		(w) =>
			isRunFamily(w.family) &&
			w.date >= cutoffIso &&
			(w.distanceMeters ?? 0) > 500 &&
			(w.durationSeconds ?? 0) > 0
	);
	let sistePace: number | null = null;
	if (recentRuns.length > 0) {
		const totalSec = recentRuns.reduce((s, w) => s + (w.durationSeconds ?? 0), 0);
		const totalKm = recentRuns.reduce((s, w) => s + (w.distanceMeters ?? 0) / 1000, 0);
		sistePace = totalKm > 0 ? Math.round(totalSec / totalKm) : null;
	}

	// Lengste løp siste 6 uker → tak for neste øktlengde
	const lengsteLopKm = Math.max(0, ...workouts.filter((w) => isRunFamily(w.family)).map((w) => (w.distanceMeters ?? 0) / 1000));

	return {
		week: { weekTargetKm, deload, runKm, eqKmNonRun, totalEqKm, remainingKm, stallRebased },
		forventetPaceSekPerKm: Math.round(pace),
		sistePaceSekPerKm: sistePace,
		lengsteLopKmSiste6Uker: Math.round(lengsteLopKm * 10) / 10
	};
}

/**
 * Neste løpeøkt: hvile hvis uken er (nesten) i mål; ellers easy-løp med
 * gjenstående volum, klampet til [3, lengsteSiste × 1.15]; langtur-bias
 * på lørdag/søndag når det gjenstår nok.
 */
export function nextEnduranceSession(
	state: EnduranceState,
	isoWeekdayNumber: number
): SessionSuggestion | null {
	const { remainingKm } = state.week;
	if (remainingKm <= 1) return null; // uken er i mål — hvile

	const maxLen = state.lengsteLopKmSiste6Uker > 0 ? state.lengsteLopKmSiste6Uker * 1.15 : 6;
	const distanceKm = Math.min(Math.max(remainingKm, 3), maxLen);
	const isWeekend = isoWeekdayNumber >= 6;
	const longRun = isWeekend && distanceKm >= 6;

	return {
		kind: 'run',
		name: longRun ? 'Langtur' : 'Rolig løp',
		plannedRun: {
			runType: longRun ? 'long' : 'easy',
			targetDistanceMeters: Math.round(distanceKm * 10) * 100,
			paceHintSecPerKm: state.forventetPaceSekPerKm,
			notes: state.week.deload
				? 'Deload-uke — hold det rolig.'
				: state.week.stallRebased
					? 'Målet er justert ned etter en rolig uke — bygg gradvis.'
					: undefined
		}
	};
}

/** Beste ukes-total (eqKm) i registreringene — for ukes_km-milepælene. */
export function bestWeekEqKm(
	workouts: EnduranceWorkout[],
	goal: EnduranceGoal,
	config: EnduranceConfig,
	window: TrackWindow
): number {
	const byWeek = new Map<string, EnduranceWorkout[]>();
	for (const w of workouts) {
		const key = weekKeyOf(w.date);
		const list = byWeek.get(key) ?? [];
		list.push(w);
		byWeek.set(key, list);
	}
	let best = 0;
	for (const [weekKey, list] of byWeek) {
		const pace = curvePace(goal, window, weekKey);
		const { targetKm } = curveWeekKm(goal, config, window, weekKey);
		const sums = sumWeek(list, pace);
		const total = sums.runKm + Math.min(sums.nonRunEqKm, config.maksIkkeLopAndel * targetKm);
		best = Math.max(best, total);
	}
	return Math.round(best * 10) / 10;
}
