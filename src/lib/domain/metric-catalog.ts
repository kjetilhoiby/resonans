export type MetricDirection = 'higher_is_better' | 'lower_is_better' | 'towards_target';

export type MetricId =
	| 'running_distance'
	| 'sleep_avg_night'
	| 'sleep_lag'
	| 'steps_avg_day'
	| 'active_minutes_avg_day'
	| 'weight_change'
	| 'grocery_spend';

export interface MetricDefinition {
	id: MetricId;
	label: string;
	aliases: string[];
	defaultUnit: string;
	direction: MetricDirection;
	widgetMetricType?: string;
	supportedWindows: Array<'7d' | '30d' | '365d' | 'week' | 'month' | 'quarter' | 'year'>;
}

export const METRIC_CATALOG: Record<MetricId, MetricDefinition> = {
	running_distance: {
		id: 'running_distance',
		label: 'Akkumulert løpedistanse',
		aliases: ['running_distance', 'distance', 'running', 'løp', 'løping', 'run_km'],
		defaultUnit: 'km',
		direction: 'higher_is_better',
		widgetMetricType: 'distance',
		supportedWindows: ['7d', '30d', '365d', 'week', 'month', 'quarter', 'year']
	},
	sleep_avg_night: {
		id: 'sleep_avg_night',
		label: 'Snitt søvnmengde pr. natt',
		aliases: ['sleep_avg_night', 'sleep', 'sleepDuration', 'søvn'],
		defaultUnit: 't',
		direction: 'higher_is_better',
		widgetMetricType: 'sleepDuration',
		supportedWindows: ['7d', '30d', '365d', 'week', 'month', 'quarter', 'year']
	},
	sleep_lag: {
		id: 'sleep_lag',
		label: 'Søvnlag',
		aliases: ['sleep_lag', 'sleepLag', 'earlyWake', 'søvnlag'],
		defaultUnit: 'indeks',
		direction: 'lower_is_better',
		supportedWindows: ['7d', '30d', '365d', 'week', 'month', 'quarter', 'year']
	},
	steps_avg_day: {
		id: 'steps_avg_day',
		label: 'Snitt skritt pr. dag',
		aliases: ['steps_avg_day', 'steps', 'skritt'],
		defaultUnit: 'skritt',
		direction: 'higher_is_better',
		widgetMetricType: 'steps',
		supportedWindows: ['7d', '30d', '365d', 'week', 'month', 'quarter', 'year']
	},
	active_minutes_avg_day: {
		id: 'active_minutes_avg_day',
		label: 'Snitt aktive minutter pr. dag',
		aliases: ['active_minutes_avg_day', 'intenseMinutes', 'activeMinutes', 'aktive minutter'],
		defaultUnit: 'min',
		direction: 'higher_is_better',
		supportedWindows: ['7d', '30d', '365d', 'week', 'month', 'quarter', 'year']
	},
	weight_change: {
		id: 'weight_change',
		label: 'Endring i vekt',
		aliases: ['weight_change', 'weight_delta', 'weight', 'vekt'],
		defaultUnit: 'kg',
		direction: 'towards_target',
		widgetMetricType: 'weight',
		supportedWindows: ['7d', '30d', '365d', 'week', 'month', 'quarter', 'year']
	},
	grocery_spend: {
		id: 'grocery_spend',
		label: 'Forbruk dagligvarer',
		aliases: ['grocery_spend', 'dagligvare', 'dagligvarer', 'grocery'],
		defaultUnit: 'kr',
		direction: 'lower_is_better',
		widgetMetricType: 'amount',
		supportedWindows: ['7d', '30d', '365d', 'week', 'month', 'quarter', 'year']
	}
};

export function resolveMetricId(input: string): MetricId | null {
	const normalized = input.trim().toLowerCase();
	for (const metric of Object.values(METRIC_CATALOG)) {
		if (metric.id === normalized || metric.aliases.includes(normalized)) {
			return metric.id;
		}
	}
	return null;
}
