export type MetricDirection = 'higher_is_better' | 'lower_is_better' | 'towards_target';

export type MetricId =
	| 'running_distance'
	| 'running_10k_time'
	| 'running_5k_time'
	| 'resting_heart_rate'
	| 'weekly_effort'
	| 'fat_mass'
	| 'muscle_mass'
	| 'sleep_avg_night'
	| 'sleep_lag'
	| 'steps_avg_day'
	| 'active_minutes_avg_day'
	| 'weight_change'
	| 'grocery_spend'
	| 'category_spend'
	| 'monthly_savings';

export interface MetricDefinition {
	id: MetricId;
	label: string;
	aliases: string[];
	defaultUnit: string;
	direction: MetricDirection;
	widgetMetricType?: string;
	visualizationFamily?: 'trajectory' | 'target_zone' | 'comparison';
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
		visualizationFamily: 'trajectory',
		supportedWindows: ['7d', '30d', '365d', 'week', 'month', 'quarter', 'year']
	},
	running_10k_time: {
		id: 'running_10k_time',
		// Beste 10 km-tid i vinduet (fra canonical_workouts.bestEfforts['10k']), sekunder
		label: 'Beste 10 km-tid',
		aliases: ['running_10k_time', '10k', '10 km', '10km', '10 km tid', 'mila'],
		defaultUnit: 'sek',
		direction: 'lower_is_better',
		visualizationFamily: 'trajectory',
		supportedWindows: ['30d', '365d', 'month', 'quarter', 'year']
	},
	running_5k_time: {
		id: 'running_5k_time',
		// Beste 5 km-tid i vinduet (fra canonical_workouts.bestEfforts['5k']), sekunder
		label: 'Beste 5 km-tid',
		aliases: ['running_5k_time', '5k', '5 km', '5km', '5 km tid', 'femmern'],
		defaultUnit: 'sek',
		direction: 'lower_is_better',
		visualizationFamily: 'trajectory',
		supportedWindows: ['30d', '365d', 'month', 'quarter', 'year']
	},
	resting_heart_rate: {
		id: 'resting_heart_rate',
		// Snittpuls under søvn siste 7 netter (proxy for hvilepuls)
		label: 'Hvilepuls',
		aliases: ['resting_heart_rate', 'hvilepuls', 'sleepHeartRate', 'restingHr', 'puls i hvile'],
		defaultUnit: 'slag/min',
		direction: 'lower_is_better',
		visualizationFamily: 'target_zone',
		supportedWindows: ['7d', '30d', '365d', 'week', 'month', 'quarter', 'year']
	},
	weekly_effort: {
		id: 'weekly_effort',
		// Sum av per-økt effort-score (TRIMP/MET) per uke, fra sensor_aggregates.weeklyEffort
		label: 'Ukentlig treningsbelastning',
		aliases: ['weekly_effort', 'weeklyEffort', 'belastning', 'treningsbelastning', 'effort'],
		defaultUnit: 'poeng',
		direction: 'higher_is_better',
		visualizationFamily: 'target_zone',
		supportedWindows: ['week', 'month', 'quarter', 'year']
	},
	fat_mass: {
		id: 'fat_mass',
		// Siste fettmasse-måling fra Withings-vekta (data.fatMass)
		label: 'Fettmasse',
		aliases: ['fat_mass', 'fatMass', 'fettmasse', 'fettprosent', 'fett'],
		defaultUnit: 'kg',
		direction: 'lower_is_better',
		visualizationFamily: 'trajectory',
		supportedWindows: ['30d', '365d', 'month', 'quarter', 'year']
	},
	muscle_mass: {
		id: 'muscle_mass',
		// Siste muskelmasse-måling fra Withings-vekta (data.muscleMass)
		label: 'Muskelmasse',
		aliases: ['muscle_mass', 'muscleMass', 'muskelmasse', 'muskler'],
		defaultUnit: 'kg',
		direction: 'higher_is_better',
		visualizationFamily: 'trajectory',
		supportedWindows: ['30d', '365d', 'month', 'quarter', 'year']
	},
	sleep_avg_night: {
		id: 'sleep_avg_night',
		label: 'Snitt søvnmengde pr. natt',
		aliases: ['sleep_avg_night', 'sleep', 'sleepDuration', 'søvn'],
		defaultUnit: 't',
		direction: 'higher_is_better',
		widgetMetricType: 'sleepDuration',
		visualizationFamily: 'target_zone',
		supportedWindows: ['7d', '30d', '365d', 'week', 'month', 'quarter', 'year']
	},
	sleep_lag: {
		id: 'sleep_lag',
		label: 'Søvnlag',
		aliases: ['sleep_lag', 'sleepLag', 'earlyWake', 'søvnlag'],
		defaultUnit: 'indeks',
		direction: 'lower_is_better',
		visualizationFamily: 'target_zone',
		supportedWindows: ['7d', '30d', '365d', 'week', 'month', 'quarter', 'year']
	},
	steps_avg_day: {
		id: 'steps_avg_day',
		label: 'Snitt skritt pr. dag',
		aliases: ['steps_avg_day', 'steps', 'skritt'],
		defaultUnit: 'skritt',
		direction: 'higher_is_better',
		widgetMetricType: 'steps',
		visualizationFamily: 'comparison',
		supportedWindows: ['7d', '30d', '365d', 'week', 'month', 'quarter', 'year']
	},
	active_minutes_avg_day: {
		id: 'active_minutes_avg_day',
		label: 'Snitt aktive minutter pr. dag',
		aliases: ['active_minutes_avg_day', 'intenseMinutes', 'activeMinutes', 'aktive minutter'],
		defaultUnit: 'min',
		direction: 'higher_is_better',
		visualizationFamily: 'comparison',
		supportedWindows: ['7d', '30d', '365d', 'week', 'month', 'quarter', 'year']
	},
	weight_change: {
		id: 'weight_change',
		label: 'Endring i vekt',
		aliases: ['weight_change', 'weight_delta', 'weight', 'vekt'],
		defaultUnit: 'kg',
		direction: 'towards_target',
		widgetMetricType: 'weight',
		visualizationFamily: 'trajectory',
		supportedWindows: ['7d', '30d', '365d', 'week', 'month', 'quarter', 'year']
	},
	grocery_spend: {
		id: 'grocery_spend',
		label: 'Forbruk dagligvarer',
		aliases: ['grocery_spend', 'dagligvare', 'dagligvarer', 'grocery'],
		defaultUnit: 'kr',
		direction: 'lower_is_better',
		widgetMetricType: 'amount',
		visualizationFamily: 'trajectory',
		supportedWindows: ['7d', '30d', '365d', 'week', 'month', 'quarter', 'year']
	},
	category_spend: {
		id: 'category_spend',
		// Månedlig forbruk i en valgt kategori (categorized_events); kategorien
		// bæres i goals.metadata.spendCategory. Forbrukstak — lavere er bedre.
		label: 'Månedlig forbruk (kategori)',
		aliases: ['category_spend', 'kategoriforbruk', 'forbrukstak', 'budsjett'],
		defaultUnit: 'kr',
		direction: 'lower_is_better',
		widgetMetricType: 'amount',
		visualizationFamily: 'trajectory',
		supportedWindows: ['month', 'quarter', 'year']
	},
	monthly_savings: {
		id: 'monthly_savings',
		// Sum av 'sparing'-kategoriserte transaksjoner per måned (categorized_events)
		label: 'Månedlig sparebeløp',
		aliases: ['monthly_savings', 'sparing', 'sparebeløp', 'sparerate', 'savings'],
		defaultUnit: 'kr',
		direction: 'higher_is_better',
		widgetMetricType: 'amount',
		visualizationFamily: 'trajectory',
		supportedWindows: ['month', 'quarter', 'year']
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
