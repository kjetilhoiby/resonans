/**
 * Dokumenttyper i skriveprosjekt og notatblokk.
 *
 * Ett `kind`-felt dekker både prosjektmateriale (scene, kapittel, karakter, sted)
 * og fritt notatblokk-innhold (notat, dikt, liste, transkripsjon). Begrunnelsen
 * står i docs/changelog/2026-08-07-skriveprosjekt.md: dette er dokumenter med ulik
 * rolle, ikke ulike ting — og fire tabeller ville gitt fire søkeveier.
 *
 * `ordered` skiller de typene som utgjør selve manuset (og derfor har en
 * meningsfull rekkefølge via sortOrder) fra materialet rundt. Det er den
 * distinksjonen «skrive det hele sammen» hviler på: scener og kapitler har en
 * rekkefølge, karakterer og steder har det ikke.
 */

export const WRITING_DOC_KINDS = [
	'scene',
	'kapittel',
	'karakter',
	'sted',
	'grep',
	'notat',
	'dikt',
	'liste',
	'transkripsjon'
] as const;

export type WritingDocKind = (typeof WRITING_DOC_KINDS)[number];

export const DEFAULT_DOC_KIND: WritingDocKind = 'notat';

export interface WritingDocKindDef {
	key: WritingDocKind;
	label: string;
	emoji: string;
	/** Inngår i manusets rekkefølge (sortOrder er meningsbærende). */
	ordered: boolean;
}

export const WRITING_DOC_KIND_DEFS: WritingDocKindDef[] = [
	{ key: 'kapittel', label: 'Kapittel', emoji: '📕', ordered: true },
	{ key: 'scene', label: 'Scene', emoji: '🎬', ordered: true },
	{ key: 'karakter', label: 'Karakter', emoji: '🧍', ordered: false },
	{ key: 'sted', label: 'Sted', emoji: '🗺️', ordered: false },
	// Fortellergrep: refleksjon over håndverk, med idéer man krysser av når de er
	// brukt. Egen kind fordi den endrer oppførsel — den er INTENSJON, og det er
	// nettopp det redaktør-modus skal se («får jeg til det jeg prøver på?»).
	// En scene sier ikke hva den forsøker.
	{ key: 'grep', label: 'Fortellergrep', emoji: '🎭', ordered: false },
	{ key: 'dikt', label: 'Dikt', emoji: '🕊️', ordered: false },
	{ key: 'notat', label: 'Notat', emoji: '📝', ordered: false },
	{ key: 'liste', label: 'Liste', emoji: '☑️', ordered: false },
	{ key: 'transkripsjon', label: 'Transkripsjon', emoji: '🎙️', ordered: false }
];

const BY_KEY = new Map<string, WritingDocKindDef>(WRITING_DOC_KIND_DEFS.map((d) => [d.key, d]));

export function isWritingDocKind(value: unknown): value is WritingDocKind {
	return typeof value === 'string' && BY_KEY.has(value);
}

/** Slår opp definisjonen, med fallback til 'notat' for ukjent/manglende kind. */
export function resolveDocKind(kind: string | null | undefined): WritingDocKindDef {
	return (kind && BY_KEY.get(kind)) || BY_KEY.get(DEFAULT_DOC_KIND)!;
}

export const WRITING_DOC_STATUSES = ['utkast', 'pagar', 'ferdig'] as const;
export type WritingDocStatus = (typeof WRITING_DOC_STATUSES)[number];

export function isWritingDocStatus(value: unknown): value is WritingDocStatus {
	return typeof value === 'string' && (WRITING_DOC_STATUSES as readonly string[]).includes(value);
}

/**
 * Tittel til visning. Et dokument kan lagres uten tittel — særlig fra mobil, der
 * man skriver først og navngir siden — og da er førstelinja bedre enn «Uten
 * tittel». Faller tilbake til typenavnet når også kroppen er tom, slik at lista
 * aldri viser en rad uten tekst.
 */
export function displayTitle(doc: { title?: string | null; body?: string | null; kind?: string | null }): string {
	const title = doc.title?.trim();
	if (title) return title;

	const firstLine = doc.body?.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
	if (firstLine) return firstLine.length > 60 ? `${firstLine.slice(0, 59)}…` : firstLine;

	return `Uten tittel (${resolveDocKind(doc.kind).label.toLowerCase()})`;
}

/**
 * Ordtelling for skrivestreaken (fase 4) og for «hvor langt er jeg».
 * Bevisst enkel: splitt på whitespace. Norsk bindestrek-sammensetning teller som
 * ett ord, som er riktig — «kjøkkenbenk-lampe» er ett ord.
 */
export function countWords(body: string | null | undefined): number {
	const text = body?.trim();
	if (!text) return 0;
	return text.split(/\s+/).length;
}
