/**
 * Ren logikk for tale-assistentens forteller-modus (interaktive fortellinger).
 *
 * Alt her er rene funksjoner (ingen DB, ingen IO) slik at board-projeksjon, world-sammenslåing
 * og blank-bokføring kan enhetstestes isolert. De DB-/LLM-koblede verktøyene i `story-tools.ts`
 * bygger oppå disse. Speiler `quiz-logic.ts`.
 *
 * To varianter deler ett board:
 *   - `branching`: velg-selv-eventyr med a/b-valg som forgrener. To faser: `setup` (bygg verden,
 *     hyppige spørsmål) og `adventure` (lev i verdenen, handlingsorienterte valg).
 *   - `madlib`: tulle-fortelling der agenten ber om ord og vever dem inn til slutt.
 *
 * Sentral invariant: `story` (full tekst) er SKJULT til `ended === true`, så en delt skjerm i
 * baksetet ikke røper slutten. Gatingen ligger i `projectStoryBoard` og er enhetstestet.
 */

export type StoryKind = 'branching' | 'madlib';
export type StoryPhase = 'setup' | 'adventure';

/** Et fakta-kort i den fantastiske verdenen (vises som «Verden»-kort på skjermen). */
export interface WorldEntry {
	label: string;
	value: string;
}

/** Et valg i et velg-selv-eventyr. Stabile id-er «a»/«b». */
export interface StoryChoice {
	id: string;
	label: string;
}

/** Et tidligere avsnitt + valget som førte videre fra det (intern historikk). */
export interface HistoryEntry {
	passage: string;
	choiceLabel: string | null;
}

/** Et innsamlet ord i en madlib (slot = hva som ble spurt om, word = ordet de ga). */
export interface FilledBlank {
	slot: string;
	word: string;
}

/** Lagret tilstand for en fortelling (DB-radens rene form). */
export interface StorySessionState {
	kind: StoryKind;
	title: string | null;
	theme: string | null;
	currentPlayer: string | null;
	active: boolean;
	ended: boolean;
	story: string | null;
	// branching
	phase: StoryPhase | null;
	world: WorldEntry[];
	passage: string | null;
	choices: StoryChoice[];
	lastChoice: string | null;
	step: number;
	// madlib
	request: string | null;
	blanksFilled: number;
	blanksTotal: number;
	filled: FilledBlank[];
}

/** Det offentlige board-skjemaet — det skjermen (status + delt lenke) viser. */
export interface StoryBoardView {
	active: boolean;
	kind: StoryKind;
	title: string | null;
	theme: string | null;
	currentPlayer: string | null;
	ended: boolean;
	story: string | null; // full tekst — kun når ended, ellers skjult
	// branching (null/tom for madlib)
	phase: StoryPhase | null;
	world: WorldEntry[];
	passage: string | null;
	choices: StoryChoice[]; // tom når ended
	lastChoice: string | null;
	step: number;
	// madlib (null/tom for branching)
	request: string | null; // ordet agenten ber om nå; null når alle samlet eller ended
	blanksFilled: number;
	blanksTotal: number;
	filled: FilledBlank[];
}

/**
 * Projiser en fortelling til det skjermen viser. Holder `story` (full tekst) SKJULT til
 * `ended === true`, så en delt skjerm i baksetet ikke røper slutten. Den motsatte variantens
 * felt nulles/tømmes (ett board dekker begge variantene). Ren, så gatingen kan enhetstestes.
 */
export function projectStoryBoard(s: StorySessionState): StoryBoardView {
	const branching = s.kind === 'branching';
	const madlib = s.kind === 'madlib';
	return {
		active: s.active,
		kind: s.kind,
		title: s.title,
		theme: s.theme,
		currentPlayer: s.currentPlayer,
		ended: s.ended,
		story: s.ended ? s.story : null,
		// branching
		phase: branching ? s.phase : null,
		world: branching ? s.world : [],
		passage: branching ? s.passage : null,
		choices: branching && !s.ended ? s.choices : [],
		lastChoice: branching ? s.lastChoice : null,
		step: branching ? s.step : 0,
		// madlib
		request: madlib && !s.ended ? s.request : null,
		blanksFilled: madlib ? s.blanksFilled : 0,
		blanksTotal: madlib ? s.blanksTotal : 0,
		filled: madlib ? s.filled : []
	};
}

/** Map en lagret fortelling (DB-rad) til den rene tilstanden board-projeksjonen forventer. */
export function toStorySessionState(row: {
	kind: string;
	title: string | null;
	theme: string | null;
	currentPlayer: string | null;
	active: boolean;
	ended: boolean;
	story: string | null;
	phase: string | null;
	world: WorldEntry[] | null;
	passage: string | null;
	choices: StoryChoice[] | null;
	lastChoice: string | null;
	step: number;
	request: string | null;
	blanksFilled: number;
	blanksTotal: number;
	filled: FilledBlank[] | null;
}): StorySessionState {
	return {
		kind: row.kind === 'madlib' ? 'madlib' : 'branching',
		title: row.title,
		theme: row.theme,
		currentPlayer: row.currentPlayer,
		active: row.active,
		ended: row.ended,
		story: row.story,
		phase: row.phase === 'setup' || row.phase === 'adventure' ? row.phase : null,
		world: row.world ?? [],
		passage: row.passage,
		choices: row.choices ?? [],
		lastChoice: row.lastChoice,
		step: row.step,
		request: row.request,
		blanksFilled: row.blanksFilled,
		blanksTotal: row.blanksTotal,
		filled: row.filled ?? []
	};
}

/**
 * Slå nye fakta inn i den voksende verdenen. Entries med samme `label` (case-insensitivt)
 * oppdateres på plass; nye legges til bakerst. Lar agenten sende bare det som er nytt/endret
 * uten å miste det som alt er låst. Ren.
 */
export function mergeWorld(existing: WorldEntry[], incoming: WorldEntry[]): WorldEntry[] {
	const out = existing.map((e) => ({ ...e }));
	for (const raw of incoming) {
		const label = (raw?.label ?? '').trim();
		const value = (raw?.value ?? '').trim();
		if (!label || !value) continue;
		const idx = out.findIndex((e) => e.label.toLowerCase() === label.toLowerCase());
		if (idx === -1) out.push({ label, value });
		else out[idx] = { label, value };
	}
	return out;
}

/** Normaliser et world-array fra et verktøykall (dropper poster uten label/value). */
export function coerceWorld(raw: unknown): WorldEntry[] {
	if (!Array.isArray(raw)) return [];
	const out: WorldEntry[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const o = item as Record<string, unknown>;
		const label = typeof o.label === 'string' ? o.label.trim() : '';
		const value = typeof o.value === 'string' ? o.value.trim() : '';
		if (!label || !value) continue;
		out.push({ label, value });
	}
	return out;
}

/**
 * Normaliser valgene fra et verktøykall. Trimmer id/label, dropper ufullstendige, deduper på id,
 * og kutter til maks to (et velg-selv-eventyr har alltid nøyaktig to valg, «a» og «b»).
 */
export function coerceChoices(raw: unknown): StoryChoice[] {
	if (!Array.isArray(raw)) return [];
	const out: StoryChoice[] = [];
	const seen = new Set<string>();
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const o = item as Record<string, unknown>;
		const id = typeof o.id === 'string' ? o.id.trim() : '';
		const label = typeof o.label === 'string' ? o.label.trim() : '';
		if (!id || !label || seen.has(id.toLowerCase())) continue;
		seen.add(id.toLowerCase());
		out.push({ id, label });
		if (out.length >= 2) break;
	}
	return out;
}

/** Begrens blanksTotal til et fornuftig madlib-intervall (1–20). null/ugyldig ⇒ 6. */
export function normalizeBlanksTotal(raw: unknown): number {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) return 6;
	return Math.min(Math.max(Math.round(raw), 1), 20);
}

/** Hvilket ord agenten bør be om nå: neste ufylte slot, eller null når alle er samlet. */
export function allBlanksFilled(blanksFilled: number, blanksTotal: number): boolean {
	return blanksTotal > 0 && blanksFilled >= blanksTotal;
}
