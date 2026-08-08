/**
 * Sammenslåing av søketreff fra de to lagringsstedene notatblokka spenner over:
 * `writing_docs` (dokumenter man redigerer) og `reflections` (fangst — dagsnotater,
 * feriedagbok, refleksjoner).
 *
 * Det er dette som gjør «to flater» til én søkeopplevelse. Rangeringen på tvers er
 * forsvarlig fordi begge tabellene har `embedding vector(1536)` fra samme modell
 * (text-embedding-3-small), så cosine-likhetene er direkte sammenlignbare — det er
 * den eneste grunnen til at et enkelt sortert flettesteg er riktig her, og den
 * slutter å holde om noen bytter modell i én av tabellene.
 */

import { displayTitle, resolveDocKind } from './doc-kinds';
import { parseChecklist } from './checklist';

export type NotebookSource = 'dokument' | 'fangst';

export interface NotebookHit {
	id: string;
	source: NotebookSource;
	title: string;
	/** Kort utdrag til lista — aldri hele kroppen. */
	excerpt: string;
	kind: string;
	kindLabel: string;
	emoji: string;
	projectId: string | null;
	/** ISO. For dokumenter: updatedAt. For fangst: createdAt. */
	timestamp: string;
	/** 0–1 cosine-likhet, eller null når søket falt tilbake til tekstmatch. */
	similarity: number | null;
	/** Tom for fangst — reflections har ingen tags. */
	tags: string[];
	/** «4 av 11 brukt», eller null når dokumentet ikke har en avkryssingsliste. */
	checklist: { done: number; total: number } | null;
}

export interface DocRow {
	id: string;
	kind: string;
	title: string | null;
	body: string | null;
	projectId: string | null;
	updatedAt: Date | string;
	tags?: string[] | null;
}

export interface ReflectionRow {
	id: string;
	kind: string;
	periodKey: string | null;
	content: string;
	createdAt: Date | string;
}

const EXCERPT_CHARS = 180;

function iso(value: Date | string): string {
	return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Førstelinje-uavhengig utdrag: kollapser blanke linjer så lista ikke får hull. */
export function excerptOf(text: string | null | undefined, limit = EXCERPT_CHARS): string {
	const flat = (text ?? '').replace(/\s+/g, ' ').trim();
	if (flat.length <= limit) return flat;
	return `${flat.slice(0, limit - 1)}…`;
}

/**
 * Fangst har ingen tittel — den er en logg-rad. Vi viser typen på norsk, slik at
 * en rad i lista sier hva den er («Dagsnotat», «Reisedagbok») framfor å låne de
 * interne kind-nøklene.
 */
const REFLECTION_LABELS: Record<string, string> = {
	notat: 'Dagsnotat',
	feriedagbok: 'Reisedagbok',
	day_close: 'Dagsavslutning',
	week_review: 'Ukerefleksjon',
	month_review: 'Månedsrefleksjon',
	goal_check: 'Målsjekk',
	reflection_light: 'Refleksjon',
	livsintervju: 'Livsintervju',
	livsintervju_chat: 'Livsintervju (transkript)',
	retningssamtale: 'Retningssamtale',
	retningsgap: 'Retningsnotat'
};

export function reflectionLabel(kind: string): string {
	return REFLECTION_LABELS[kind] ?? 'Refleksjon';
}

export function docToHit(row: DocRow, similarity: number | null): NotebookHit {
	const def = resolveDocKind(row.kind);
	return {
		id: row.id,
		source: 'dokument',
		title: displayTitle(row),
		excerpt: excerptOf(row.body),
		kind: row.kind,
		kindLabel: def.label,
		emoji: def.emoji,
		projectId: row.projectId,
		timestamp: iso(row.updatedAt),
		similarity,
		tags: row.tags ?? [],
		checklist: (() => {
			const parsed = parseChecklist(row.body);
			return parsed.total > 0 ? { done: parsed.done, total: parsed.total } : null;
		})()
	};
}

export function reflectionToHit(row: ReflectionRow, similarity: number | null): NotebookHit {
	const label = reflectionLabel(row.kind);
	return {
		id: row.id,
		source: 'fangst',
		title: row.periodKey ? `${label} · ${row.periodKey}` : label,
		excerpt: excerptOf(row.content),
		kind: row.kind,
		kindLabel: label,
		emoji: '🕘',
		projectId: null,
		timestamp: iso(row.createdAt),
		similarity,
		tags: [],
		checklist: null
	};
}

/**
 * Fletter og rangerer treff fra begge kilder.
 *
 * Med likhetsscore sorteres det på likhet; uten (tekst-fallback eller ren
 * «nyeste først») sorteres det på tid. Blandingen kan i prinsippet inneholde
 * begge deler — da rangeres treff *med* score først, fordi et semantisk treff er
 * et svar på spørsmålet mens en fersk rad bare er fersk.
 */
export function mergeHits(hits: NotebookHit[], limit?: number): NotebookHit[] {
	const sorted = [...hits].sort((a, b) => {
		const aHas = a.similarity !== null;
		const bHas = b.similarity !== null;
		if (aHas && bHas) return b.similarity! - a.similarity!;
		if (aHas !== bHas) return aHas ? -1 : 1;
		return b.timestamp.localeCompare(a.timestamp);
	});
	return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
}
