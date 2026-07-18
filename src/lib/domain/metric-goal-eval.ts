/**
 * Generisk evaluering av målbare mål (metricId + targetValue) for visning med
 * sone-bar på Mål-fanen: hvilepuls, ukentlig belastning, 5k/10k-tid, fett-/
 * muskelmasse. Ren logikk — DB-lesingen bor i goal-progress.ts og mal-loaderen.
 */

import type { MetricDirection } from './metric-catalog';

export interface MetricGoalEvalInput {
	metricId: string;
	direction: MetricDirection;
	/** Nåverdi fra leseren, null uten data */
	current: number | null;
	target: number;
}

export interface MetricGoalEval {
	metricId: string;
	current: number | null;
	target: number;
	unit: string;
	withinTarget: boolean | null;
	/** Sone-modus for TargetZoneBar */
	mode: 'at_least' | 'at_most';
	domainMin: number;
	domainMax: number;
	/** Valgfri kontekstlinje, f.eks. «4-ukers snitt: 310» */
	contextLabel?: string | null;
}

/**
 * Bygg sone-evaluering: lavere-er-bedre → at_most-sone, ellers at_least.
 * Domenet spenner målet ± ~25 % og utvides så nåverdien alltid er synlig.
 */
export function buildMetricGoalEval(
	input: MetricGoalEvalInput & { unit: string; contextLabel?: string | null }
): MetricGoalEval {
	const lower = input.direction === 'lower_is_better';
	const mode = lower ? ('at_most' as const) : ('at_least' as const);

	const withinTarget =
		input.current === null ? null : lower ? input.current <= input.target : input.current >= input.target;

	const span = Math.max(Math.abs(input.target) * 0.25, 1);
	let domainMin = input.target - span;
	let domainMax = input.target + span;
	if (input.current !== null) {
		domainMin = Math.min(domainMin, input.current - span * 0.2);
		domainMax = Math.max(domainMax, input.current + span * 0.2);
	}
	if (domainMin < 0 && input.target >= 0) domainMin = 0;

	return {
		metricId: input.metricId,
		current: input.current,
		target: input.target,
		unit: input.unit,
		withinTarget,
		mode,
		domainMin,
		domainMax,
		contextLabel: input.contextLabel ?? null
	};
}
