/**
 * Manuset som helhet: rekkefølge og sammenhengende lesing.
 *
 * `sortOrder` fantes fra fase 1, men uten en måte å endre den på var manuset bare
 * en liste sortert på opprettelsestidspunkt. Det er dette «skrive det hele
 * sammen» hviler på — se docs/changelog/2026-08-07-skriveprosjekt.md.
 */

import { countWords, displayTitle } from './doc-kinds';

export interface OrderableDoc {
	id: string;
	sortOrder: number;
}

/**
 * Gir alle dokumenter en unik, tett rekkefølge 0..n-1 i den rekkefølgen de
 * ligger i lista.
 *
 * Nødvendig fordi alle rader starter på `sortOrder = 0`: uten normalisering
 * ville «flytt opp» sammenlignet nuller og ikke gjort noe. Sorteringen i basen
 * bruker `createdAt` som sekundærnøkkel, så lista som kommer inn her er allerede
 * i den rekkefølgen brukeren ser.
 */
export function normalizeOrder<T extends OrderableDoc>(docs: T[]): T[] {
	return docs.map((doc, index) => ({ ...doc, sortOrder: index }));
}

export type MoveDirection = 'opp' | 'ned';

/**
 * Flytter ett dokument én plass opp eller ned og returnerer hele lista med ny,
 * tett rekkefølge.
 *
 * Returnerer lista **uendret** når dokumentet ikke finnes eller allerede ligger
 * ytterst. Kalleren skal kunne kalle dette uten å sjekke først — en «flytt opp»
 * på øverste element er en no-op, ikke en feil.
 */
export function moveDoc<T extends OrderableDoc>(
	docs: T[],
	id: string,
	direction: MoveDirection
): T[] {
	const ordered = [...docs].sort((a, b) => a.sortOrder - b.sortOrder);
	const index = ordered.findIndex((d) => d.id === id);
	if (index === -1) return docs;

	const target = direction === 'opp' ? index - 1 : index + 1;
	if (target < 0 || target >= ordered.length) return docs;

	[ordered[index], ordered[target]] = [ordered[target], ordered[index]];
	return normalizeOrder(ordered);
}

/**
 * Bygger rekkefølgen fra en liste med id-er (den formen API-et tar imot).
 *
 * Id-er som ikke finnes i `docs` ignoreres, og dokumenter som mangler i `order`
 * legges bakerst i sin opprinnelige rekkefølge — en klient som er ute av synk
 * skal ikke kunne slette et kapittel fra manuset ved å utelate det.
 */
export function applyOrder<T extends OrderableDoc>(docs: T[], order: string[]): T[] {
	const byId = new Map(docs.map((d) => [d.id, d]));
	const seen = new Set<string>();
	const result: T[] = [];

	for (const id of order) {
		const doc = byId.get(id);
		if (doc && !seen.has(id)) {
			result.push(doc);
			seen.add(id);
		}
	}
	for (const doc of [...docs].sort((a, b) => a.sortOrder - b.sortOrder)) {
		if (!seen.has(doc.id)) result.push(doc);
	}

	return normalizeOrder(result);
}

export interface CompilableDoc {
	id: string;
	kind: string;
	title: string | null;
	body: string | null;
	sortOrder: number;
}

export interface CompiledPart {
	id: string;
	title: string;
	words: number;
	/** Tegnposisjonen delen starter på i den sammenhengende teksten. */
	offset: number;
}

export interface CompiledManuscript {
	text: string;
	words: number;
	parts: CompiledPart[];
}

/** Skillet mellom deler i sammenhengende lesing. */
const PART_SEPARATOR = '\n\n';

/**
 * Setter manuset sammen til én lesbar tekst, i rekkefølge.
 *
 * Tomme deler tas med i `parts` (de er del av manuset, og en scene uten tekst er
 * en scene du ikke har skrevet ennå) men bidrar ikke med tekst — ellers hadde
 * sammenhengende lesing fått hull av blanke linjer.
 */
export function compileManuscript(docs: CompilableDoc[]): CompiledManuscript {
	const ordered = [...docs].sort((a, b) => a.sortOrder - b.sortOrder);

	const parts: CompiledPart[] = [];
	const chunks: string[] = [];
	let offset = 0;

	for (const doc of ordered) {
		const body = (doc.body ?? '').trim();
		const title = displayTitle(doc);

		parts.push({ id: doc.id, title, words: countWords(body), offset });

		if (!body) continue;

		const chunk = `## ${title}\n\n${body}`;
		chunks.push(chunk);
		offset += chunk.length + PART_SEPARATOR.length;
	}

	const text = chunks.join(PART_SEPARATOR);
	return {
		text,
		words: parts.reduce((sum, p) => sum + p.words, 0),
		parts
	};
}
