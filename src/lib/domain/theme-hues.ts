export type ThemeHueKey =
	| 'default'
	| 'relations'
	| 'health'
	| 'economy'
	| 'family'
	| 'work'
	| 'literature'
	| 'reflection';

export const THEME_HUES: Record<ThemeHueKey, number> = {
	default: 228,
	relations: 148,
	health: 172,
	economy: 38,
	family: 156,
	work: 212,
	literature: 24,
	reflection: 196,
};

function normalizeThemeName(name: string | null | undefined): string {
	return (name ?? '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
}

const MATCHERS: Array<{ key: ThemeHueKey; terms: string[] }> = [
	{ key: 'relations', terms: ['relasjon', 'partner', 'parforhold', 'ekteskap', 'samliv', 'vennskap'] },
	{ key: 'family', terms: ['familie', 'barn', 'foreldre', 'foreldreliv', 'mamma', 'pappa'] },
	{ key: 'health', terms: ['helse', 'trening', 'loping', 'sovn', 'aktivitet', 'vitalitet'] },
	{ key: 'economy', terms: ['okonomi', 'bank', 'forbruk', 'budsjett', 'sparing', 'lonn'] },
	{ key: 'work', terms: ['jobb', 'arbeid', 'karriere', 'prosjekt', 'fokus'] },
	{ key: 'literature', terms: ['litteratur', 'bok', 'boker', 'lesing', 'skriving'] },
	{ key: 'reflection', terms: ['meditasjon', 'refleksjon', 'dagbok', 'ro', 'mindfulness', 'personlig utvikling'] },
];

export function getThemeHueKey(name: string | null | undefined): ThemeHueKey {
	const normalizedName = normalizeThemeName(name);

	for (const matcher of MATCHERS) {
		if (matcher.terms.some((term) => normalizedName.includes(term))) {
			return matcher.key;
		}
	}

	return 'default';
}

export function getThemeHue(name: string | null | undefined): number {
	return THEME_HUES[getThemeHueKey(name)];
}

export function getThemeHueStyle(name: string | null | undefined): string {
	return `--theme-hue:${getThemeHue(name)};`;
}