// Parser for prosjekt-oppgavetekst — speiler mønsteret til detectMealPrefix i food/index.ts.
// Støtter «kjøp: X» (innkjøp) og «kjøp: X på [butikk]» (innkjøp + butikk).
// «på» tolkes kun når «kjøp:»-prefikset er til stede, for å unngå å feiltolke vanlige
// setninger som «monter hylle på vegg».

const KJOP_PATTERN = /^kj[øo]p\s*[:：]\s*(.+)$/i;
const STORE_PATTERN = /^(.*?\S)\s+p[åa]\s+(.+)$/i;

export interface ParsedTask {
	text: string;
	shopping: boolean;
	store?: string;
}

export function parseTaskText(raw: string): ParsedTask {
	let text = raw.trim();
	let shopping = false;
	let store: string | undefined;

	const kjop = text.match(KJOP_PATTERN);
	if (kjop) {
		shopping = true;
		text = kjop[1].trim();

		const withStore = text.match(STORE_PATTERN);
		if (withStore) {
			text = withStore[1].trim();
			store = withStore[2].trim();
		}
	}

	return { text, shopping, ...(store ? { store } : {}) };
}
