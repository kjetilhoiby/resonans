import type { MetricId } from './metric-catalog';

export type MetricVisualizationKind =
	| 'progress_bar'
	| 'timeline_marker'
	| 'trajectory'
	| 'target_zone_bar'
	| 'comparison_trend';

export type MetricThresholdMode = 'at_least' | 'at_most' | 'range' | 'trajectory' | 'vs_average';

export interface MetricVisualizationPreset {
	metricId: MetricId;
	summary: MetricVisualizationKind;
	detail?: MetricVisualizationKind;
	thresholdMode?: MetricThresholdMode;
	preferredComparators?: string[];
	notes?: string;
}

export const METRIC_VISUALIZATION_PRESETS: Record<MetricId, MetricVisualizationPreset> = {
	running_distance: {
		metricId: 'running_distance',
		summary: 'progress_bar',
		detail: 'trajectory',
		thresholdMode: 'trajectory',
		preferredComparators: ['target_total', 'expected_by_now'],
		notes: 'Akkumulert måling mot et totalmål over tid.'
	},
	sleep_avg_night: {
		metricId: 'sleep_avg_night',
		summary: 'target_zone_bar',
		detail: 'trajectory',
		thresholdMode: 'at_least',
		preferredComparators: ['target_min', 'rolling_average'],
		notes: 'Typisk Withings-visning: nåverdi mot en minimums- eller mål-sone.'
	},
	sleep_lag: {
		metricId: 'sleep_lag',
		summary: 'target_zone_bar',
		detail: 'comparison_trend',
		thresholdMode: 'at_most',
		preferredComparators: ['target_max', 'recent_average'],
		notes: 'Lavere er bedre; terskel eller øvre grense er naturlig.'
	},
	steps_avg_day: {
		metricId: 'steps_avg_day',
		summary: 'target_zone_bar',
		detail: 'comparison_trend',
		thresholdMode: 'range',
		preferredComparators: ['target_range', 'day_average_curve'],
		notes: 'Kan vises som mellom-sone eller som nå mot snitt gjennom dagen.'
	},
	active_minutes_avg_day: {
		metricId: 'active_minutes_avg_day',
		summary: 'target_zone_bar',
		detail: 'comparison_trend',
		thresholdMode: 'at_least',
		preferredComparators: ['target_min', 'day_average_curve'],
		notes: 'Nå mot dagssnitt eller mot minimumsmål.'
	},
	weight_change: {
		metricId: 'weight_change',
		summary: 'timeline_marker',
		detail: 'trajectory',
		thresholdMode: 'trajectory',
		preferredComparators: ['target_weight', 'expected_weight_by_now'],
		notes: 'Relativ fremdrift mot tidsbestemt mål; burndown i detalj.'
	},
	grocery_spend: {
		metricId: 'grocery_spend',
		summary: 'progress_bar',
		detail: 'trajectory',
		thresholdMode: 'at_most',
		preferredComparators: ['budget_cap', 'expected_spend_by_now'],
		notes: 'Kumulativt forbruk mot budsjett eller kostnadstak.'
	}
};

export function getMetricVisualizationPreset(metricId: MetricId): MetricVisualizationPreset {
	return METRIC_VISUALIZATION_PRESETS[metricId];
}