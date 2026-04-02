export type WidgetMetricType =
	| 'weight'
	| 'sleepDuration'
	| 'steps'
	| 'distance'
	| 'workoutCount'
	| 'heartrate'
	| 'mood'
	| 'screenTime'
	| 'amount';

export type WidgetAggregation = 'avg' | 'sum' | 'count' | 'latest';
export type WidgetPeriod = 'day' | 'week' | 'month';
export type WidgetRange = 'last7' | 'last14' | 'last30' | 'current_week' | 'current_month' | 'current_year';

export type WidgetDraft = {
	title: string;
	metricType: WidgetMetricType;
	aggregation: WidgetAggregation;
	period: WidgetPeriod;
	range: WidgetRange;
	filterCategory: string | null;
	unit: string;
	goal: number | null;
	color: string;
};

export const WIDGET_DRAFT_SCHEMA_VERSION = 1;
