import type { EffortBudget, EnduranceWorkout, SessionSuggestion } from './types';
import { isoWeekday } from './curve';
import { isRunFamily } from './endurance-engine';

export type DayOwner = 'utholdenhet' | 'hvile';
export type WeekdayPattern = Record<number, DayOwner>;

/**
 * Planen legger KUN inn løpeøkter (eller hvile). Sykkel og styrke planlegges
 * aldri — de antas å skje når det passer og trekkes fra når de registreres
 * (sykkel mot effort-budsjettet, styrke mot progresjon/milepæler). Styrkemål
 * ligger som stående targets tilgjengelige i Ekko uavhengig av dag.
 */

const PATTERN_LOOKBACK_DAYS = 42; // 6 uker
const MIN_RUNS_PER_WEEKDAY = 2; // færre enn dette på 6 uker → ikke en løpedag
const MIN_TOTAL_RUNS = 5; // tynnere historikk → default-mønster

/** Default løpedager før mønsteret har nok historikk: tir/tor/lør. */
export const DEFAULT_RUN_PATTERN: WeekdayPattern = {
	1: 'hvile',
	2: 'utholdenhet',
	3: 'hvile',
	4: 'utholdenhet',
	5: 'hvile',
	6: 'utholdenhet',
	7: 'hvile'
};

/**
 * Utleder løpedagene av faktisk atferd siste ~6 uker: ukedager brukeren
 * faktisk pleier å løpe blir løpedager. Mønsteret «blir til og justeres
 * underveis» — beregnes ved lesing, ingen cron. Manuelt satt
 * `plan.schedule.days` overstyrer (håndteres av kalleren).
 */
export function deriveWeekdayPattern(
	enduranceWorkouts: EnduranceWorkout[],
	today: string
): WeekdayPattern {
	const cutoff = new Date(`${today}T00:00:00Z`);
	cutoff.setUTCDate(cutoff.getUTCDate() - PATTERN_LOOKBACK_DAYS);
	const cutoffIso = cutoff.toISOString().slice(0, 10);

	const runCounts = new Map<number, number>();
	for (let d = 1; d <= 7; d++) runCounts.set(d, 0);

	let totalRuns = 0;
	for (const w of enduranceWorkouts) {
		if (w.date < cutoffIso || !isRunFamily(w.family)) continue;
		const day = isoWeekday(w.date);
		runCounts.set(day, (runCounts.get(day) ?? 0) + 1);
		totalRuns += 1;
	}

	if (totalRuns < MIN_TOTAL_RUNS) {
		return { ...DEFAULT_RUN_PATTERN };
	}

	const pattern: WeekdayPattern = {};
	for (let d = 1; d <= 7; d++) {
		pattern[d] = (runCounts.get(d) ?? 0) >= MIN_RUNS_PER_WEEKDAY ? 'utholdenhet' : 'hvile';
	}
	return pattern;
}

/**
 * Velger dagens planlagte økt (kun løp eller hvile). Prioritet:
 *  1. Effort-budsjettet anbefaler hvile (høy akutt belastning) → hviledag.
 *  2. Løpedag, men budsjettet er brukt opp → hviledag med begrunnelse.
 *  3. Løpedag → løpsforslaget (kan være null hvis løpsuken alt er i mål).
 *  4. Ellers hvile — styrke/sykkel gjøres når det passer og fanges av
 *     auto-koblingen når de registreres.
 */
export function suggestSessionForDate(
	date: string,
	schedule: Record<string, string> | undefined,
	pattern: WeekdayPattern,
	enduranceSuggestion: SessionSuggestion | null,
	budget: EffortBudget | null
): { owner: DayOwner; suggestion: SessionSuggestion | null; restReason: string | null } {
	const weekday = isoWeekday(date);
	const scheduled = schedule?.[String(weekday)];
	// Manuell overstyring: 'utholdenhet' = løpedag, alt annet = ingen planlagt løping
	const owner: DayOwner =
		scheduled != null
			? scheduled === 'utholdenhet'
				? 'utholdenhet'
				: 'hvile'
			: (pattern[weekday] ?? 'hvile');

	if (budget?.restRecommended) {
		return {
			owner: 'hvile',
			suggestion: null,
			restReason: 'Høy belastning siste 3 dager — ta en rolig dag.'
		};
	}

	if (owner === 'hvile') return { owner, suggestion: null, restReason: null };

	if (budget != null && budget.remainingMax <= 0) {
		return {
			owner: 'hvile',
			suggestion: null,
			restReason: 'Ukas effort-budsjett er brukt opp — hvile eller helt rolig.'
		};
	}

	return { owner, suggestion: enduranceSuggestion, restReason: null };
}
