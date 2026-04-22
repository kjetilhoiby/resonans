import type { MetricId, MetricDirection } from './metric-catalog';
import type { MetricThresholdMode, MetricVisualizationKind } from './metric-visualizations';

/**
 * The three display contexts – inspired by the S/M/L (frimerke/stripe/kort) framework.
 *
 *  S — frimerke:  a single number or status icon in a very tight space (widget, list badge)
 *  M — stripe:    a horizontal progress/zone bar with label, fits inside a list row or card header
 *  L — kort:      a full card with a detail chart and annotations
 */
export type VisualizationSize = 'S' | 'M' | 'L';

/**
 * How values progress through time.
 *
 *  point        — single snapshot (weight today, last night's sleep)
 *  accumulated  — running total vs. a goal (km this month)
 *  rolling_avg  — smoothed average over a window (avg steps/day last 7d)
 *  trajectory   — time-bound trend toward a deadline target (weight loss plan)
 */
export type TimeModel = 'point' | 'accumulated' | 'rolling_avg' | 'trajectory';

/**
 * The semantic intent — what "good" means for this metric.
 *
 *  higher      — more is better, with an optional minimum target
 *  lower       — less is better, with an optional maximum/cap
 *  target      — converging toward a specific value from either direction
 *  range       — within a zone is good, outside is not
 *  vs_average  — current value relative to a rolling baseline/average
 */
export type VisualizationSemantic = 'higher' | 'lower' | 'target' | 'range' | 'vs_average';

/**
 * What a component needs to render in a given context.
 * Each missing field has a defined fallback so components never crash.
 */
export interface VisualizationDataContract {
	current: number | null;
	updatedAt?: string; // ISO date string
	confidence?: 'high' | 'medium' | 'low' | 'estimated';
	// Threshold fields — which are required depends on thresholdMode
	target?: number; // at_least / at_most / trajectory end-goal
	targetMin?: number; // range
	targetMax?: number; // range
	expectedByNow?: number; // trajectory / vs_average baseline
	// For detail chart (L context)
	series?: Array<{ date: string; value: number }>;
	/** For comparison_trend chart: pairs of current + reference per label/period */
	comparisonSeries?: Array<{ label: string; current: number; reference: number }>;
	startDate?: string;
	endDate?: string;
	startValue?: number;
}

/** What happens in a context when data is missing */
export type FallbackStrategy = 'skeleton' | 'dash' | 'last_known';

export interface ContextSlot {
	component: MetricVisualizationKind;
	fallback: FallbackStrategy;
}

/**
 * Full specification for how a metric should be visualized across all three contexts.
 * This is the single source of truth for rendering decisions — components should
 * derive their rendering from a VisualizationSpec + VisualizationDataContract pair.
 */
export interface VisualizationSpec {
	metricId: MetricId;
	semantic: VisualizationSemantic;
	timeModel: TimeModel;
	thresholdMode: MetricThresholdMode;
	direction: MetricDirection;
	/** Tolerance band for status computation, e.g. 0.1 = ±10% around target */
	tolerancePct: number;
	contexts: {
		S: ContextSlot;
		M: ContextSlot;
		L: ContextSlot;
	};
}

// ---------------------------------------------------------------------------
// Presets — one per MetricId
// ---------------------------------------------------------------------------

export const VISUALIZATION_SPECS: Record<MetricId, VisualizationSpec> = {
	running_distance: {
		metricId: 'running_distance',
		semantic: 'higher',
		timeModel: 'accumulated',
		thresholdMode: 'trajectory',
		direction: 'higher_is_better',
		tolerancePct: 0.05,
		contexts: {
			S: { component: 'progress_bar', fallback: 'dash' },
			M: { component: 'progress_bar', fallback: 'dash' },
			L: { component: 'trajectory', fallback: 'skeleton' }
		}
	},

	weight_change: {
		metricId: 'weight_change',
		semantic: 'target',
		timeModel: 'trajectory',
		thresholdMode: 'trajectory',
		direction: 'towards_target',
		tolerancePct: 0.05,
		contexts: {
			S: { component: 'timeline_marker', fallback: 'dash' },
			M: { component: 'timeline_marker', fallback: 'dash' },
			L: { component: 'trajectory', fallback: 'skeleton' }
		}
	},

	sleep_avg_night: {
		metricId: 'sleep_avg_night',
		semantic: 'higher',
		timeModel: 'rolling_avg',
		thresholdMode: 'at_least',
		direction: 'higher_is_better',
		tolerancePct: 0.1,
		contexts: {
			S: { component: 'target_zone_bar', fallback: 'dash' },
			M: { component: 'target_zone_bar', fallback: 'dash' },
			L: { component: 'comparison_trend', fallback: 'skeleton' }
		}
	},

	sleep_lag: {
		metricId: 'sleep_lag',
		semantic: 'lower',
		timeModel: 'rolling_avg',
		thresholdMode: 'at_most',
		direction: 'lower_is_better',
		tolerancePct: 0.1,
		contexts: {
			S: { component: 'target_zone_bar', fallback: 'dash' },
			M: { component: 'target_zone_bar', fallback: 'dash' },
			L: { component: 'comparison_trend', fallback: 'skeleton' }
		}
	},

	steps_avg_day: {
		metricId: 'steps_avg_day',
		semantic: 'range',
		timeModel: 'rolling_avg',
		thresholdMode: 'range',
		direction: 'higher_is_better',
		tolerancePct: 0.1,
		contexts: {
			S: { component: 'target_zone_bar', fallback: 'dash' },
			M: { component: 'target_zone_bar', fallback: 'dash' },
			L: { component: 'comparison_trend', fallback: 'skeleton' }
		}
	},

	active_minutes_avg_day: {
		metricId: 'active_minutes_avg_day',
		semantic: 'higher',
		timeModel: 'rolling_avg',
		thresholdMode: 'at_least',
		direction: 'higher_is_better',
		tolerancePct: 0.1,
		contexts: {
			S: { component: 'target_zone_bar', fallback: 'dash' },
			M: { component: 'target_zone_bar', fallback: 'dash' },
			L: { component: 'comparison_trend', fallback: 'skeleton' }
		}
	},

	grocery_spend: {
		metricId: 'grocery_spend',
		semantic: 'lower',
		timeModel: 'accumulated',
		thresholdMode: 'at_most',
		direction: 'lower_is_better',
		tolerancePct: 0.05,
		contexts: {
			S: { component: 'progress_bar', fallback: 'dash' },
			M: { component: 'progress_bar', fallback: 'dash' },
			L: { component: 'trajectory', fallback: 'skeleton' }
		}
	}
};

export function getVisualizationSpec(metricId: MetricId): VisualizationSpec {
	return VISUALIZATION_SPECS[metricId];
}
