import type { MetricDirection } from './metric-catalog';
import type { MetricThresholdMode } from './metric-visualizations';

export type VisualizationStatus = 'ahead' | 'on_track' | 'behind' | 'out_of_zone' | 'no_data';

export interface StatusInput {
	current: number | null | undefined;
	direction: MetricDirection;
	thresholdMode: MetricThresholdMode;
	tolerancePct?: number; // e.g. 0.1 = ±10% band around target
	// at_least / at_most
	target?: number;
	// range
	targetMin?: number;
	targetMax?: number;
	// trajectory / accumulated
	expectedByNow?: number;
}

/**
 * Single shared function for all metric status computation.
 * Returns a canonical status that maps directly to visual tone.
 */
export function computeStatus(input: StatusInput): VisualizationStatus {
	const {
		current,
		direction,
		thresholdMode,
		tolerancePct = 0.1,
		target,
		targetMin,
		targetMax,
		expectedByNow
	} = input;

	if (current === null || current === undefined) return 'no_data';

	switch (thresholdMode) {
		case 'trajectory':
		case 'at_least': {
			const ref = thresholdMode === 'trajectory' ? expectedByNow : target;
			if (ref === undefined) return 'no_data';

			if (direction === 'lower_is_better') {
				if (current <= ref * (1 - tolerancePct)) return 'ahead';
				if (current <= ref) return 'on_track';
				return 'behind';
			}
			// higher_is_better or towards_target (treated as higher here)
			if (current >= ref * (1 + tolerancePct)) return 'ahead';
			if (current >= ref * (1 - tolerancePct)) return 'on_track';
			return 'behind';
		}

		case 'at_most': {
			if (target === undefined) return 'no_data';
			if (current <= target * (1 - tolerancePct)) return 'ahead';
			if (current <= target) return 'on_track';
			return 'behind';
		}

		case 'range': {
			if (targetMin === undefined || targetMax === undefined) return 'no_data';
			if (current >= targetMin && current <= targetMax) return 'on_track';
			return 'out_of_zone';
		}

		case 'vs_average': {
			// vs_average: compare current to expectedByNow (the rolling average baseline)
			if (expectedByNow === undefined) return 'no_data';
			if (direction === 'lower_is_better') {
				if (current <= expectedByNow * (1 - tolerancePct)) return 'ahead';
				if (current <= expectedByNow * (1 + tolerancePct)) return 'on_track';
				return 'behind';
			}
			if (current >= expectedByNow * (1 + tolerancePct)) return 'ahead';
			if (current >= expectedByNow * (1 - tolerancePct)) return 'on_track';
			return 'behind';
		}
	}
}

/**
 * Maps VisualizationStatus to the CSS tone used by visualization components.
 */
export function statusToTone(
	status: VisualizationStatus
): 'green' | 'yellow' | 'red' | 'accent' | 'muted' {
	switch (status) {
		case 'ahead':
			return 'green';
		case 'on_track':
			return 'accent';
		case 'behind':
			return 'yellow';
		case 'out_of_zone':
			return 'red';
		case 'no_data':
			return 'muted';
	}
}
