export type DashboardKind = 'health' | 'economics' | 'travel' | 'books';

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
	},
	{
		kind: 'travel',
		terms: [
			'tur',
			'turer',
			'reise',
			'reiser',
			'ferie',
			'ferieturer',
			'utland',
			'utenlandstur',
			'trip',
			'travel',
			'vacation',
			'holiday',
			'backpacking',
			'city-break',
			'citybreak',
			'road trip',
			'roadtrip',
			'krydstokt',
			'cruise',
			'fly',
			'flytur'
		]
	},
	{
		kind: 'books',
		terms: [
			'bok',
			'bøker',
			'lesing',
			'litteratur',
			'reading',
			'books',
			'literature',
			'bibliotek',
			'library'
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
	},
	travel: {
		kind: 'travel',
		label: 'Tur',
		icon: '🗺️'
	},
	books: {
		kind: 'books',
		label: 'Bøker',
		icon: '📚'
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
	// Split into words for precise matching — prevents e.g. "tur" (3 chars) matching "litteratur"
	const words = normalized.split(/\s+/);

	for (const matcher of THEME_DASHBOARD_MATCHERS) {
		if (matcher.terms.some((term) => {
			const t = normalizeThemeName(term);
			// Exact word match for all terms; also substring match for longer terms (≥5 chars)
			// so that compounds like "sommerferie" still match "ferie"
			return words.some((w) => w === t) || (t.length >= 5 && normalized.includes(t));
		})) {
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