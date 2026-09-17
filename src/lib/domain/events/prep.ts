/**
 * Forberedelsene rundt et arrangement.
 *
 * Billetten er kjøpt; det som gjenstår er alt det andre. To av punktene går
 * igjen så ofte at de er standard — transport og barnevakt — men lista er en
 * liste, ikke to boolean-kolonner: overnatting, middag før, henting av billett
 * i luka og «spør naboen» dukker opp i halvparten av tilfellene, og en ny
 * kolonne per variant er en migrasjon hver gang.
 *
 * Lagres som jsonb på arrangementet framfor som checklist_items. Grunnen er at
 * de hører til ARRANGEMENTET, ikke til en dag: barnevakt ordnes seks uker i
 * forveien, og et dag-punkt måtte da ligget på en dag ingen har planlagt ennå.
 */

import type { EventPrepItem } from '$lib/db/schema';

export type { EventPrepItem };

/**
 * Forslagene som tilbys på et nytt arrangement.
 *
 * `id` er en stabil nøkkel, ikke etiketten: endrer vi teksten senere, skal et
 * punkt brukeren alt har haket av fortsatt være det samme punktet.
 */
export const PREP_SUGGESTIONS: Array<{ id: string; label: string }> = [
	{ id: 'transport', label: 'Transport' },
	{ id: 'barnevakt', label: 'Barnevakt' },
	{ id: 'overnatting', label: 'Overnatting' },
	{ id: 'billetter', label: 'Billetter hentet' },
	{ id: 'middag', label: 'Middag før' }
];

/**
 * De to som legges på automatisk.
 *
 * Bevisst kort. Et nytt arrangement med fem uhakede punkter ser ut som en
 * jobbliste man ikke har begynt på; to punkter ser ut som det de er. Resten
 * ligger et trykk unna i `PREP_SUGGESTIONS`.
 */
export const DEFAULT_PREP_IDS = ['transport', 'barnevakt'];

function slugify(label: string): string {
	return label
		.toLowerCase()
		.trim()
		.replace(/[æ]/g, 'ae')
		.replace(/[ø]/g, 'oe')
		.replace(/[å]/g, 'aa')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** Unik id for et punkt med fritekst-etikett, som ikke kolliderer med de eksisterende. */
export function prepIdFor(label: string, existing: EventPrepItem[]): string {
	const base = slugify(label) || 'punkt';
	if (!existing.some((p) => p.id === base)) return base;
	for (let i = 2; i < 100; i++) {
		const candidate = `${base}-${i}`;
		if (!existing.some((p) => p.id === candidate)) return candidate;
	}
	return `${base}-${Date.now()}`;
}

export function makePrepItem(id: string, label: string): EventPrepItem {
	return { id, label, done: false, doneAt: null };
}

/** Standardsettet et nytt arrangement får. */
export function defaultPrep(): EventPrepItem[] {
	return DEFAULT_PREP_IDS.map((id) => {
		const suggestion = PREP_SUGGESTIONS.find((s) => s.id === id);
		return makePrepItem(id, suggestion?.label ?? id);
	});
}

/**
 * Hak av / hak av igjen.
 *
 * `doneAt` settes ved avhaking og NULLES ved av-haking — et tidsstempel som blir
 * stående etter at haken er borte er en påstand om at noe ble gjort.
 */
export function togglePrep(
	prep: EventPrepItem[],
	id: string,
	done: boolean,
	now: Date = new Date()
): EventPrepItem[] {
	return prep.map((item) =>
		item.id === id ? { ...item, done, doneAt: done ? now.toISOString() : null } : item
	);
}

/** Legg til et punkt. Finnes id-en fra før, er kallet en no-op — ikke et duplikat. */
export function addPrep(prep: EventPrepItem[], label: string): EventPrepItem[] {
	const trimmed = label.trim();
	if (!trimmed) return prep;
	if (prep.some((p) => p.label.toLowerCase() === trimmed.toLowerCase())) return prep;
	return [...prep, makePrepItem(prepIdFor(trimmed, prep), trimmed)];
}

export function removePrep(prep: EventPrepItem[], id: string): EventPrepItem[] {
	return prep.filter((item) => item.id !== id);
}

/** Forslagene som ikke alt ligger på arrangementet. */
export function remainingSuggestions(prep: EventPrepItem[]): Array<{ id: string; label: string }> {
	return PREP_SUGGESTIONS.filter((s) => !prep.some((p) => p.id === s.id));
}

export interface PrepStanding {
	total: number;
	done: number;
	/** Punktene som gjenstår, i rekkefølge — det er dem en påminnelse skal nevne. */
	openLabels: string[];
	allDone: boolean;
}

export function prepStanding(prep: EventPrepItem[]): PrepStanding {
	const open = prep.filter((p) => !p.done);
	return {
		total: prep.length,
		done: prep.length - open.length,
		openLabels: open.map((p) => p.label),
		allDone: prep.length > 0 && open.length === 0
	};
}

/**
 * Én linje om hva som gjenstår, eller null når det ikke er noe å si.
 *
 * Navngir punktene framfor å telle dem: «Mangler: barnevakt» kan handles på,
 * «1 av 2 igjen» tvinger deg til å åpne arrangementet for å finne ut hva.
 * Samme regel som `describeOpenItems` i dags-nudgene.
 */
export function describePrep(prep: EventPrepItem[]): string | null {
	const standing = prepStanding(prep);
	if (standing.total === 0) return null;
	if (standing.allDone) return 'Alt klart';
	const labels = standing.openLabels.map((l) => l.toLowerCase());
	if (labels.length === 1) return `Mangler ${labels[0]}`;
	if (labels.length === 2) return `Mangler ${labels[0]} og ${labels[1]}`;
	return `Mangler ${labels.slice(0, -1).join(', ')} og ${labels[labels.length - 1]}`;
}

/** Normaliser rader fra basen — en jsonb-kolonne kan inneholde hva som helst. */
export function normalizePrep(value: unknown): EventPrepItem[] {
	if (!Array.isArray(value)) return [];
	const out: EventPrepItem[] = [];
	for (const raw of value) {
		if (!raw || typeof raw !== 'object') continue;
		const item = raw as Record<string, unknown>;
		const label = typeof item.label === 'string' ? item.label.trim() : '';
		if (!label) continue;
		const id = typeof item.id === 'string' && item.id ? item.id : prepIdFor(label, out);
		if (out.some((p) => p.id === id)) continue;
		out.push({
			id,
			label,
			done: item.done === true,
			doneAt: typeof item.doneAt === 'string' ? item.doneAt : null,
			note: typeof item.note === 'string' ? item.note : null
		});
	}
	return out;
}
