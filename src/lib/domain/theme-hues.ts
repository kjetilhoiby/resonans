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

// NB: normalizeThemeName dekomponerer bare tegn som HAR en kanonisk
// dekomponering — «å» blir «a», men «ø» og «æ» står igjen som seg selv.
// Termer må derfor skrives med norske tegn (evt. begge skrivemåter), ellers
// matcher de aldri. Samme konvensjon som theme-dashboard-registry.
const MATCHERS: Array<{ key: ThemeHueKey; terms: string[] }> = [
	{ key: 'relations', terms: ['relasjon', 'partner', 'parforhold', 'ekteskap', 'samliv', 'vennskap'] },
	{ key: 'family', terms: ['familie', 'barn', 'foreldre', 'foreldreliv', 'mamma', 'pappa'] },
	{
		// Helse-familien: mortemaet og alle undertemaene deler hue, slik at
		// View-Transition-crossfaden mellom mor og barn ikke skifter farge.
		key: 'health',
		terms: [
			'helse', 'vitalitet', 'aktivitet', 'vekt', 'kropp',
			'trening', 'løping', 'loping', 'styrke', 'utholdenhet',
			'søvn', 'sovn', 'restitusjon', 'hvile',
			'ernæring', 'ernaring', 'kosthold',
			'skjermtid', 'egenfrekvens'
		]
	},
	{ key: 'economy', terms: ['økonomi', 'okonomi', 'bank', 'forbruk', 'budsjett', 'sparing', 'lønn', 'lonn'] },
	{ key: 'work', terms: ['jobb', 'arbeid', 'karriere', 'prosjekt', 'fokus'] },
	{ key: 'literature', terms: ['litteratur', 'bok', 'bøker', 'boker', 'lesing', 'skriving'] },
	{ key: 'reflection', terms: ['meditasjon', 'refleksjon', 'dagbok', 'mindfulness', 'personlig utvikling'] },
];

// Korte termer (< 4 tegn) må matche som helt ord. Uten denne vakten fanget
// f.eks. «ro» ordet «kropp», og «bok» ville fanget «bokse».
const WHOLE_WORD_MAX_LENGTH = 3;

export function getThemeHueKey(name: string | null | undefined): ThemeHueKey {
	const normalizedName = normalizeThemeName(name);
	const words = normalizedName.split(/[\s-]+/);

	for (const matcher of MATCHERS) {
		if (
			matcher.terms.some((term) =>
				term.length <= WHOLE_WORD_MAX_LENGTH
					? words.includes(term)
					: normalizedName.includes(term)
			)
		) {
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