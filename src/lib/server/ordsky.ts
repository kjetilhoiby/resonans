/**
 * Ordsky — vektet ordfrekvens fra fritekst (sjekkliste-oppgaver, notater).
 * Ren beregning: tokeniserer norsk tekst, filtrerer stoppord og teller.
 */

export interface OrdskyWord {
	word: string;
	count: number;
	/** 0..1 relativ vekt (1 = vanligste ordet) — styrer skriftstørrelse i skyen */
	weight: number;
}

// Grammatiske stoppord — innholdsord (verb som «rydde», «kjøpe») beholdes med vilje,
// det er de som gjør skyen morsom.
const STOPWORDS = new Set([
	'og', 'i', 'på', 'til', 'med', 'av', 'for', 'det', 'den', 'de', 'en', 'et', 'ei',
	'er', 'som', 'å', 'at', 'har', 'ikke', 'jeg', 'du', 'han', 'hun', 'vi', 'dere',
	'seg', 'sin', 'sitt', 'sine', 'min', 'mitt', 'mine', 'din', 'ditt', 'dine',
	'om', 'så', 'men', 'eller', 'hva', 'hvor', 'når', 'hvordan', 'hvem', 'hvis',
	'kan', 'skal', 'vil', 'må', 'bør', 'bli', 'blir', 'ble', 'vært', 'være', 'var',
	'fra', 'ut', 'opp', 'ned', 'inn', 'ute', 'inne', 'etter', 'før', 'over', 'under',
	'mellom', 'mot', 'hos', 'ved', 'da', 'nå', 'her', 'der', 'denne', 'dette', 'disse',
	'noen', 'noe', 'alle', 'alt', 'mer', 'mest', 'mye', 'man', 'bare', 'også', 'samt',
	'både', 'enn', 'ha', 'få', 'får', 'fikk', 'gjøre', 'gjør', 'ta', 'tar',
	'the', 'a', 'to', 'of', 'and', 'in', 'on', 'm', 'kl', 'ca', 'evt', 'osv'
]);

/** Tokeniser til norske ord — beholder æøå og bindestrek inni ord */
export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-zæøåäöéèüáà-]+/)
		.map((t) => t.replace(/^-+|-+$/g, ''))
		.filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

export function buildOrdsky(
	texts: string[],
	opts: { maxWords?: number; minCount?: number } = {}
): OrdskyWord[] {
	const { maxWords = 60, minCount = 2 } = opts;
	const counts = new Map<string, number>();
	for (const text of texts) {
		for (const token of tokenize(text)) {
			counts.set(token, (counts.get(token) ?? 0) + 1);
		}
	}

	const sorted = [...counts.entries()]
		.filter(([, count]) => count >= minCount)
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'nb'))
		.slice(0, maxWords);

	if (sorted.length === 0) return [];
	const max = sorted[0][1];
	const min = sorted[sorted.length - 1][1];
	const span = Math.max(1, max - min);

	return sorted.map(([word, count]) => ({
		word,
		count,
		weight: max === min ? 1 : (count - min) / span
	}));
}
