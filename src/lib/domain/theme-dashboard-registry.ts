export type DashboardKind = 'health' | 'economics';

export interface ThemeDashboardDefinition {
	kind: DashboardKind;
	label: string;
	icon: string;
}

const THEME_DASHBOARD_MATCHERS: Array<{ kind: DashboardKind; terms: string[] }> = [
	{
		kind: 'health',
		terms: [
			'helse',
			'health',
			'trening',
			'fitness',
			'workout',
			'søvn',
			'sleep',
			'vekt',
			'weight',
			'skritt',
			'steps',
			'løp',
			'run',
			'running',
			'aktivitet'
		]
	},
	{
		kind: 'economics',
		terms: [
			'økonomi',
			'economy',
			'economics',
			'forbruk',
			'utgifter',
			'inntekt',
			'budsjett',
			'sparing',
			'bank',
			'money',
			'finance',
			'finances',
			'budget',
			'spending',
			'savings'
		]
	}
];

const DASHBOARD_DEFINITIONS: Record<DashboardKind, ThemeDashboardDefinition> = {
	health: {
		kind: 'health',
		label: 'Helse',
		icon: '💪'
	},
	economics: {
		kind: 'economics',
		label: 'Økonomi',
		icon: '💰'
	}
};

function normalizeThemeName(name: string | null | undefined): string {
	return (name ?? '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim();
}

export function resolveThemeDashboardKind(themeName: string | null | undefined): DashboardKind | null {
	const normalized = normalizeThemeName(themeName);

	for (const matcher of THEME_DASHBOARD_MATCHERS) {
		if (matcher.terms.some((term) => normalized.includes(normalizeThemeName(term)))) {
			return matcher.kind;
		}
	}

	return null;
}

export function getThemeDashboardDefinition(themeName: string | null | undefined): ThemeDashboardDefinition | null {
	const kind = resolveThemeDashboardKind(themeName);
	return kind ? DASHBOARD_DEFINITIONS[kind] : null;
}

export function dashboardEndpointForTheme(themeId: string, kind: DashboardKind): string {
	return `/api/tema/${themeId}/dashboard/${kind}`;
}