import type { CreateWidgetInput } from './service';
import type { DashboardKind } from '$lib/domain/theme-dashboard-registry';

// Defaults seeded the first time a user opens a configurable theme dashboard.
// Order in the array becomes sortOrder.
const HEALTH_DEFAULTS: CreateWidgetInput[] = [
	{
		title: 'Vekt',
		metricType: 'weight',
		aggregation: 'latest',
		period: 'day',
		range: 'last30',
		unit: 'kg',
		color: '#7c8ef5'
	},
	{
		title: 'Distanse denne uka',
		metricType: 'distance',
		aggregation: 'sum',
		period: 'week',
		range: 'current_week',
		unit: 'km',
		color: '#82c882'
	},
	{
		title: 'Aktive minutter',
		metricType: 'activeMinutes',
		aggregation: 'avg',
		period: 'day',
		range: 'last7',
		unit: 'min',
		color: '#f0b429'
	},
	{
		title: 'Søvn per natt',
		metricType: 'sleepDuration',
		aggregation: 'avg',
		period: 'day',
		range: 'last7',
		unit: 't',
		color: '#5fa0a0'
	},
	{
		title: 'Skritt per dag',
		metricType: 'steps',
		aggregation: 'avg',
		period: 'day',
		range: 'last7',
		unit: 'skritt',
		color: '#82c882'
	},
	{
		title: 'Hvilepuls',
		metricType: 'heartrate',
		aggregation: 'avg',
		period: 'day',
		range: 'last7',
		unit: 'slag/min',
		color: '#e07070'
	}
];

const DEFAULTS_BY_KIND: Partial<Record<DashboardKind, CreateWidgetInput[]>> = {
	health: HEALTH_DEFAULTS
};

export function getThemeWidgetDefaults(kind: DashboardKind | null): CreateWidgetInput[] {
	if (!kind) return [];
	return DEFAULTS_BY_KIND[kind] ?? [];
}
