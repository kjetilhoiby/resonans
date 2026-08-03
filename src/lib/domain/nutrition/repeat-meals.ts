/**
 * Måltider verdt å gjenta.
 *
 * ## Hvorfor utledet framfor lagret
 *
 * «En kontorlunsj med knekkebrød og egg» er ikke en oppskrift man vil vedlikeholde
 * — det er noe man spiser hver tirsdag uten å tenke. Å kreve at brukeren først
 * *lagrer* et favorittmåltid legger en ekstra handling foran den raske veien inn,
 * og favoritter man har glemt å opprette hjelper ingen.
 *
 * Loggen vet allerede hva som gjentas. Denne modulen leser den.
 *
 * ## Rangeringen
 *
 * Antall først, deretter hvor nylig. Et måltid spist fem ganger er mer sannsynlig
 * neste enn ett spist én gang i går — men blant like hyppige vinner det ferskeste.
 *
 * Makroene tas fra **siste** forekomst, ikke som snitt: har brukeren rettet tallene
 * en gang, er det de rettede tallene som gjelder videre.
 */

import type { LoggedEntry } from './day-summary';
import type { MealSlotId } from './meal-slots';

/** Under dette er det ikke et mønster, bare et måltid. */
export const MIN_OCCURRENCES = 2;

export interface RepeatableMeal {
	/** Tittelen slik den sist ble lagret. */
	label: string;
	/** Hvor mange ganger den er logget i vinduet. */
	occurrences: number;
	/** Makroene fra siste forekomst. */
	macros: LoggedEntry['macros'];
	/** Sist gang den ble spist. */
	lastAt: string;
	/** Sloten den oftest hører til, når det finnes et flertall. */
	usualSlot: MealSlotId | null;
	/** Bildet fra siste forekomst, om det finnes. */
	imageUrl: string | null;
}

/**
 * Nøkkelen måltider grupperes på.
 *
 * Små bokstaver og normalisert mellomrom, slik at «Knekkebrød med egg» og
 * «knekkebrød  med egg» er samme måltid. Vi går ikke lenger enn det — å strippe
 * ord ville slått sammen «kaffe» og «kaffe med melk», som er ulike måltider.
 */
export function repeatKey(label: string): string {
	return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Måltider som er logget minst `MIN_OCCURRENCES` ganger, hyppigste først.
 *
 * `limit` kutter lista — flaten har plass til en håndfull, og en liste på tretti
 * er ikke raskere å bruke enn å skrive det inn.
 */
export function repeatableMeals(
	entries: LoggedEntry[],
	opts: { limit?: number; minOccurrences?: number } = {}
): RepeatableMeal[] {
	const minOccurrences = opts.minOccurrences ?? MIN_OCCURRENCES;

	const groups = new Map<string, LoggedEntry[]>();
	for (const entry of entries) {
		if (!entry.label || entry.label === 'Måltid') continue;
		if (entry.macros.kcal <= 0) continue;
		const key = repeatKey(entry.label);
		if (!key) continue;
		const bucket = groups.get(key);
		if (bucket) bucket.push(entry);
		else groups.set(key, [entry]);
	}

	const meals: RepeatableMeal[] = [];
	for (const bucket of groups.values()) {
		if (bucket.length < minOccurrences) continue;
		// Nyeste først, så «siste forekomst» er bucket[0].
		const sorted = [...bucket].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
		const latest = sorted[0];

		meals.push({
			label: latest.label,
			occurrences: sorted.length,
			macros: latest.macros,
			lastAt: latest.timestamp,
			usualSlot: dominantSlot(sorted),
			imageUrl: latest.imageUrl
		});
	}

	return meals
		.sort((a, b) => b.occurrences - a.occurrences || b.lastAt.localeCompare(a.lastAt))
		.slice(0, opts.limit ?? 6);
}

/**
 * Sloten måltidet oftest hører til, eller null uten flertall.
 *
 * Null er et ærlig svar: spiser man det like ofte til lunsj og kvelds, skal
 * klokka avgjøre når det logges på nytt.
 */
function dominantSlot(entries: LoggedEntry[]): MealSlotId | null {
	const counts = new Map<MealSlotId, number>();
	for (const entry of entries) {
		if (!entry.mealSlot) continue;
		counts.set(entry.mealSlot, (counts.get(entry.mealSlot) ?? 0) + 1);
	}
	if (counts.size === 0) return null;

	const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
	if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return null;
	return sorted[0][0];
}
