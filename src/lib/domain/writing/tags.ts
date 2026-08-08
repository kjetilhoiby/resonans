/**
 * Tags på skrivedokumenter.
 *
 * Den andre aksen: `kind` sier hva et dokument ER, tags sier hva det HANDLER OM
 * eller DELTAR I. Buer og fortellergrep går på tvers av scener, og det er
 * nettopp det tags er til for.
 *
 * ## Fritekst, ikke referanser
 *
 * En tag er en streng, ikke en peker til karakter-dokumentet. Typede referanser
 * ville krevd en koblingstabell og et UI for å vedlikeholde den; for én
 * forfatter er det feil pris. Prisen vi betaler i stedet er drift ved omdøping,
 * og motgiften er autofullføring fra tags som allerede finnes — det er den som
 * hindrer at «Idas bue» og «bue-ida» blir to.
 *
 * Repoet har et arr her: `themes.parentTheme` er fritekst mot forelderens navn
 * og ikke en fremmednøkkel, og det ga en selvløkke i prod. Forskjellen er at en
 * tag ikke styrer navigasjon — treffer den ingenting, får du et tomt filter, ikke
 * en side som ikke virker.
 */

/** Maks lengde. En tag som er en setning er et notat som har gått seg vill. */
const MAX_TAG_LENGTH = 48;

/**
 * Normaliserer én tag: trimmer, kollapser mellomrom, kutter for lange.
 *
 * **Store bokstaver bevares.** «Ida» skal vises som «Ida», ikke «ida» — tags er
 * synlige i flaten. Sammenligning gjøres case-insensitivt i stedet, se
 * `sameTag`.
 */
export function normalizeTag(raw: string): string | null {
	const trimmed = raw.replace(/\s+/g, ' ').trim().replace(/^#/, '').trim();
	if (!trimmed) return null;
	return trimmed.slice(0, MAX_TAG_LENGTH);
}

export function sameTag(a: string, b: string): boolean {
	return a.toLowerCase() === b.toLowerCase();
}

/**
 * Rensker en liste: normaliserer, fjerner tomme og duplikater.
 *
 * Duplikatsjekken er case-insensitiv, men den FØRSTE skrivemåten vinner — skrev
 * du «Ida» først, blir «ida» senere i samme lista borte, ikke omvendt.
 */
export function normalizeTags(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const out: string[] = [];
	for (const value of raw) {
		if (typeof value !== 'string') continue;
		const tag = normalizeTag(value);
		if (!tag) continue;
		if (out.some((existing) => sameTag(existing, tag))) continue;
		out.push(tag);
	}
	return out;
}

/** Har dokumentet denne taggen? Case-insensitivt. */
export function hasTag(tags: string[] | null | undefined, tag: string): boolean {
	return (tags ?? []).some((t) => sameTag(t, tag));
}

/** Deler dokumentene minst én tag? Brukes til å velge relevant materiale. */
export function sharesTag(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
	const left = a ?? [];
	const right = b ?? [];
	return left.some((tag) => right.some((other) => sameTag(tag, other)));
}

export interface TagCount {
	tag: string;
	count: number;
}

/**
 * Teller tags på tvers av dokumenter, til autofullføring og filterlista.
 *
 * Sorteres på antall (mest brukt først), deretter alfabetisk. Den vanligste
 * taggen er den man oftest skal skrive igjen, og skal ligge øverst i forslagene.
 */
export function countTags(docs: Array<{ tags?: string[] | null }>): TagCount[] {
	const counts = new Map<string, { tag: string; count: number }>();
	for (const doc of docs) {
		for (const raw of doc.tags ?? []) {
			const tag = normalizeTag(raw);
			if (!tag) continue;
			const key = tag.toLowerCase();
			const existing = counts.get(key);
			if (existing) existing.count++;
			else counts.set(key, { tag, count: 1 });
		}
	}
	return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'nb'));
}
