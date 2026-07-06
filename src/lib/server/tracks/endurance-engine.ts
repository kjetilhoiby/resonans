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
 * Utholdenhetsmotoren: ukesvolum i RENE løpe-km (14→22) og pace-progresjon
 * målt kun på løp. Sykkel og el-sykkel teller ikke her — de fanges av
 * effort-budsjettet (effort-budget.ts) som dekker samlet ukesbelastning.
 *
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

/**
 * Gangfart-registreringer klassifiseres av og til som løp (Withings-autologg)
 * og blåser opp både løpe-km og pace. Rene løpe-km krever løps-pace: raskere
 * enn 9:00/km når pace kan beregnes. Løp uten varighet teller på distanse
 * (kan ikke pace-sjekkes).
 */
const RUN_PACE_CEILING_SEK_PER_KM = 540;

export function isCountableRun(w: EnduranceWorkout): boolean {
	if (!isRunFamily(w.family)) return false;
	const meters = w.distanceMeters ?? 0;
	if (meters < 500) return false;
	const seconds = w.durationSeconds ?? 0;
	if (seconds <= 0) return true; // kan ikke pace-sjekkes — teller på distanse
	const pace = seconds / (meters / 1000);
	return pace <= RUN_PACE_CEILING_SEK_PER_KM;
}

/** Familier som teller i effort-budsjettet (ukesbelastning på tvers av løp/sykkel). */
export function countsTowardEndurance(family: string): boolean {
	return family === 'running' || family === 'cycling' || family === 'ebike';
}

/** Effort-kostnaden for 1 km løp i gitt pace (sek/km) — brukes av effort-budsjettet. */
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

/** Rene løpte km i en liste økter (kun løp i løps-pace, se isCountableRun). */
function sumRunKm(workouts: EnduranceWorkout[]): number {
	let km = 0;
	for (const w of workouts) {
		if (isCountableRun(w)) km += (w.distanceMeters ?? 0) / 1000;
	}
	return km;
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

	// Forrige uke → stall-sjekk (rene løpe-km)
	const prevMonday = new Date(`${thisWeekKey}T00:00:00Z`);
	prevMonday.setUTCDate(prevMonday.getUTCDate() - 7);
	const prevWeekKey = prevMonday.toISOString().slice(0, 10);
	const prevRunKm = sumRunKm(byWeek.get(prevWeekKey) ?? []);
	const { targetKm: prevCurveTarget } = curveWeekKm(goal, config, window, prevWeekKey);
	const hadPrevWeekData = (byWeek.get(prevWeekKey) ?? []).length > 0;
	const stallRebased = hadPrevWeekData && prevRunKm < STALL_RATIO * prevCurveTarget;
	const weekTargetKm = stallRebased
		? Math.round(Math.min(curveTarget, Math.max(3, prevRunKm * STALL_REBASE_FACTOR)) * 10) / 10
		: curveTarget;

	// Denne uken
	const runKm = Math.round(sumRunKm(byWeek.get(thisWeekKey) ?? []) * 10) / 10;
	const remainingKm = Math.max(0, Math.round((weekTargetKm - runKm) * 10) / 10);

	// Pace: snitt av løpeøkter siste 14 dager
	const cutoff = new Date(`${today}T00:00:00Z`);
	cutoff.setUTCDate(cutoff.getUTCDate() - 14);
	const cutoffIso = cutoff.toISOString().slice(0, 10);
	const recentRuns = workouts.filter(
		(w) => isCountableRun(w) && w.date >= cutoffIso && (w.durationSeconds ?? 0) > 0
	);
	let sistePace: number | null = null;
	if (recentRuns.length > 0) {
		const totalSec = recentRuns.reduce((s, w) => s + (w.durationSeconds ?? 0), 0);
		const totalKm = recentRuns.reduce((s, w) => s + (w.distanceMeters ?? 0) / 1000, 0);
		sistePace = totalKm > 0 ? Math.round(totalSec / totalKm) : null;
	}

	// Lengste løp siste 6 uker → tak for neste øktlengde
	const lengsteLopKm = Math.max(0, ...workouts.filter(isCountableRun).map((w) => (w.distanceMeters ?? 0) / 1000));

	return {
		week: { weekTargetKm, deload, runKm, remainingKm, stallRebased },
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

/** Beste ukes-total i rene løpe-km — for ukes_lop_km-milepælene. */
export function bestWeekRunKm(workouts: EnduranceWorkout[]): number {
	const byWeek = new Map<string, number>();
	for (const w of workouts) {
		if (!isCountableRun(w)) continue;
		const key = weekKeyOf(w.date);
		byWeek.set(key, (byWeek.get(key) ?? 0) + (w.distanceMeters ?? 0) / 1000);
	}
	let best = 0;
	for (const km of byWeek.values()) best = Math.max(best, km);
	return Math.round(best * 10) / 10;
}
