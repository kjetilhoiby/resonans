/**
 * Ren quiz-logikk for tale-assistentens bilferie-quizmaster.
 *
 * Alt her er rene funksjoner (ingen DB, ingen IO) slik at scoring, streaks og
 * aldersbånd kan enhetstestes isolert. De DB-/LLM-koblede verktøyene i
 * `quiz-tools.ts` bygger oppå disse. Prinsippet er at modellen IKKE skal telle
 * poeng selv (den mister tråden over et langt spill) — tellingen gjøres her og
 * persisteres, slik at «3 på rad — Nils er on fire!» blir sant, ikke gjettet.
 */

export interface QuizParticipant {
	name: string;
	age?: number | null; // alder i år fra registreringen — styrer vanskelighetsgrad i banken
	interests?: string[]; // hva spilleren liker/kan — gjør bank-spørsmål personlige
	score: number; // 1 poeng per riktige svar
	streak: number; // riktige på rad akkurat nå
	bestStreak: number; // beste streak i denne quizen
	asked: number; // antall spørsmål stilt
	correct: number; // antall riktige svar
}

/** Aldersbånd som styrer vanskelighetsgrad i spørsmålsgenereringen. */
export type AgeBand = 'småbarn' | 'barn' | 'ungdom' | 'voksen';

/** Fersk deltaker med nullstilt tracking. Navnet trimmes. */
export function newParticipant(name: string): QuizParticipant {
	return { name: name.trim(), score: 0, streak: 0, bestStreak: 0, asked: 0, correct: 0 };
}

/** Bygg en deltakerliste fra navn. Tomme/duplikate (case-insensitivt) navn fjernes. */
export function participantsFromNames(names: string[]): QuizParticipant[] {
	return participantsFromEntries(names.map((name) => ({ name })));
}

/** Én spiller slik registreringsverktøyet mottar dem: navn + alder (+ ev. interesser). */
export interface QuizPlayerEntry {
	name: string;
	age?: number | null;
	interests?: string[];
}

/**
 * Bygg en deltakerliste fra registrerings-poster ({name, age, interests?}). Tomme/duplikate
 * (case-insensitivt) navn fjernes, alder klippes til hele år i [0, 129], interesser trimmes.
 * Hele laget registreres i ETT kall — «Erle 7, Nils 9, Kjetil 42» skal bli tre poster her.
 */
export function participantsFromEntries(entries: QuizPlayerEntry[]): QuizParticipant[] {
	const seen = new Set<string>();
	const out: QuizParticipant[] = [];
	for (const entry of entries) {
		const name = (entry?.name ?? '').trim();
		if (!name) continue;
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		const p = newParticipant(name);
		const age = entry.age;
		if (typeof age === 'number' && Number.isFinite(age)) {
			const whole = Math.round(age);
			if (whole >= 0 && whole < 130) p.age = whole;
		}
		const interests = (entry.interests ?? [])
			.filter((i): i is string => typeof i === 'string' && i.trim().length > 0)
			.map((i) => i.trim())
			.slice(0, 5);
		if (interests.length > 0) p.interests = interests;
		out.push(p);
	}
	return out;
}

/** Tolk rå verktøy-argumenter (LLM-JSON) til spiller-poster. Robust mot søppel/ekstra felt. */
export function coercePlayerEntries(raw: unknown): QuizPlayerEntry[] {
	if (!Array.isArray(raw)) return [];
	const out: QuizPlayerEntry[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const o = item as Record<string, unknown>;
		const name = typeof o.name === 'string' ? o.name.trim() : '';
		if (!name) continue;
		out.push({
			name,
			age: typeof o.age === 'number' && Number.isFinite(o.age) ? o.age : null,
			interests: Array.isArray(o.interests)
				? o.interests.filter((i): i is string => typeof i === 'string')
				: []
		});
	}
	return out;
}

/**
 * Alder i hele år fra ISO fødselsdato ('YYYY-MM-DD') på en gitt dato. Returnerer
 * null for manglende/ugyldig dato. Bruker UTC-felter slik at beregningen er
 * deterministisk uavhengig av tidssone (tester kjører TZ=UTC).
 */
export function ageFromBirthDate(birthDate: string | null | undefined, today: Date): number | null {
	if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
	const [by, bm, bd] = birthDate.split('-').map((n) => Number.parseInt(n, 10));
	if (!by || !bm || !bd) return null;
	const ty = today.getUTCFullYear();
	const tm = today.getUTCMonth() + 1;
	const td = today.getUTCDate();
	let age = ty - by;
	// Trekk fra ett år hvis bursdagen ikke er passert ennå i år.
	if (tm < bm || (tm === bm && td < bd)) age -= 1;
	return age >= 0 && age < 130 ? age : null;
}

/** Aldersbånd for vanskelighetsgrad. Ukjent alder behandles som voksen. */
export function ageBand(age: number | null): AgeBand {
	if (age == null) return 'voksen';
	if (age < 6) return 'småbarn';
	if (age <= 9) return 'barn';
	if (age <= 15) return 'ungdom';
	return 'voksen';
}

/**
 * Registrer et svar på en deltaker. Returnerer en NY deltaker (muterer ikke input).
 * Riktig svar gir +1 poeng og forlenger streaken; galt svar nullstiller streaken.
 */
export function applyAnswer(p: QuizParticipant, correct: boolean): QuizParticipant {
	const streak = correct ? p.streak + 1 : 0;
	return {
		...p,
		asked: p.asked + 1,
		correct: p.correct + (correct ? 1 : 0),
		score: p.score + (correct ? 1 : 0),
		streak,
		bestStreak: Math.max(p.bestStreak, streak)
	};
}

/** Finn indeks til en deltaker ved navn (case-insensitivt, trimmet). -1 hvis ukjent. */
export function findParticipantIndex(list: QuizParticipant[], name: string): number {
	const key = (name ?? '').trim().toLowerCase();
	if (!key) return -1;
	return list.findIndex((p) => p.name.toLowerCase() === key);
}

/**
 * Er det stilt et spørsmål som ennå ikke er bokført? Brukes til å hindre at quizmasteren
 * trekker neste spørsmål før forrige svar er registrert — ellers forsvinner poenget for et
 * riktig svar (modellen sa «riktig» i tale, men bokførte aldri).
 *
 * Med spørsmålsbanken er `questionState` ('open' | 'answered') fasiten; eldre rader uten
 * tilstandskolonnen faller tilbake på den opprinnelige heuristikken (spørsmål satt uten resultat).
 */
export function hasPendingAnswer(session: {
	currentQuestion: string | null;
	lastResult: { player: string; correct: boolean } | null;
	questionState?: string | null;
}): boolean {
	if (session.questionState === 'open') return true;
	if (session.questionState === 'answered') return false;
	return !!session.currentQuestion && session.lastResult == null;
}

/* ── Spørsmålsbank ──────────────────────────────────────────────────────────────────────────── */

/**
 * Ett pre-generert spørsmål i quizens bank. Banken lages i batch (sterk modell) når laget er
 * bekreftet; spilleturer TREKKER neste ubrukte og markerer det brukt — ingen generering i
 * tur-stien. `id` er nøkkelen vurderingen (record) idempotens-sjekkes mot.
 */
export interface QuizBankQuestion {
	id: string;
	player: string;
	text: string;
	answer: string;
	category: string;
	used: boolean;
}

/**
 * Normaliser et spørsmål for gjentakelses-vern: små bokstaver, all tegnsetting/whitespace
 * kollapset til enkle mellomrom. To formuleringer som bare skiller seg i tegnsetting/casing
 * regnes som samme spørsmål.
 */
export function normalizeQuestionText(text: string): string {
	return (text ?? '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

/** Neste ubrukte bank-spørsmål for en spiller (case-insensitivt navn), i generert rekkefølge. */
export function nextUnusedQuestion(
	bank: QuizBankQuestion[],
	player: string
): QuizBankQuestion | null {
	const key = (player ?? '').trim().toLowerCase();
	if (!key) return null;
	return bank.find((q) => !q.used && q.player.toLowerCase() === key) ?? null;
}

/** Marker et bank-spørsmål som brukt. Returnerer en NY bank (muterer ikke input). */
export function markQuestionUsed(bank: QuizBankQuestion[], id: string): QuizBankQuestion[] {
	return bank.map((q) => (q.id === id ? { ...q, used: true } : q));
}

/** Antall ubrukte bank-spørsmål per spiller (nøkkel = navnet slik det står i banken). */
export function unusedCounts(bank: QuizBankQuestion[]): Record<string, number> {
	const out: Record<string, number> = {};
	for (const q of bank) {
		if (q.used) continue;
		out[q.player] = (out[q.player] ?? 0) + 1;
	}
	return out;
}

/**
 * Hvem sin tur er det etter `current`? Rotasjonen følger registreringsrekkefølgen og wrapper
 * rundt. Ukjent/`null` current gir første deltaker (spillstart). Tom liste gir null.
 */
export function nextPlayerName(list: QuizParticipant[], current: string | null): string | null {
	if (list.length === 0) return null;
	const idx = current ? findParticipantIndex(list, current) : -1;
	return list[(idx + 1) % list.length].name;
}

/**
 * Fjern genererte spørsmål som (normalisert) allerede er stilt — på tvers av brukerens siste
 * quizer — og dedupliser innad i batchen. Dette er den harde garantien mot gjentakelser;
 * eksklusjonslista i genererings-prompten er bare et hint.
 */
export function filterRepeatQuestions(
	questions: GeneratedQuestion[],
	askedNormalized: Set<string>
): GeneratedQuestion[] {
	const seen = new Set(askedNormalized);
	const out: GeneratedQuestion[] = [];
	for (const q of questions) {
		const key = normalizeQuestionText(q.question);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(q);
	}
	return out;
}

/** Stilling sortert synkende på poeng, så på nåværende streak, så alfabetisk. */
export function buildStandings(list: QuizParticipant[]): QuizParticipant[] {
	return [...list].sort(
		(a, b) => b.score - a.score || b.streak - a.streak || a.name.localeCompare(b.name, 'nb')
	);
}

/**
 * Talevennlig hint til quizmasteren om en streak — IKKE den endelige replikken,
 * bare et signal modellen kan fargelegge. Null under tre på rad.
 */
export function streakLabel(streak: number): string | null {
	if (streak >= 7) return 'uslåelig';
	if (streak >= 5) return 'on fire';
	if (streak >= 3) return 'varm';
	return null;
}

export interface KnowledgeSnapshot {
	notes?: string;
	interests: string[]; // korte snutter fra minner (det personen liker/holder på med)
	goals: string[]; // titler på aktive mål
}

function tidy(text: string, maxLen: number): string {
	const clean = text.replace(/\s+/g, ' ').trim();
	return clean.length <= maxLen ? clean : `${clean.slice(0, maxLen).trimEnd()}…`;
}

/** Dedupliser (case-insensitivt), trim, kutt lengde og antall. Ren hjelper. */
function condense(items: string[], maxItems: number, maxLen: number): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of items) {
		const value = tidy(raw ?? '', maxLen);
		if (!value) continue;
		const key = value.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(value);
		if (out.length >= maxItems) break;
	}
	return out;
}

/**
 * Kompakt interesse-/kunnskaps-snapshot for en deltaker, satt sammen av notater, minner
 * («liker Pokémon», «spiller fotball») og aktive mål. Brukes til å gjøre quiz-spørsmål
 * personlige, ikke bare aldersdifferensierte. Ren — kalleren mater inn rådata fra DB.
 */
export function buildKnowledgeSnapshot(
	input: { notes?: string | null; memories?: string[]; goals?: string[] },
	opts: { maxItems?: number; maxLen?: number } = {}
): KnowledgeSnapshot {
	const maxItems = opts.maxItems ?? 3;
	const maxLen = opts.maxLen ?? 120;
	const snapshot: KnowledgeSnapshot = {
		interests: condense(input.memories ?? [], maxItems, maxLen),
		goals: condense(input.goals ?? [], maxItems, maxLen)
	};
	const notes = tidy(input.notes ?? '', maxLen);
	if (notes) snapshot.notes = notes;
	return snapshot;
}

/** Har snapshotet noe innhold i det hele tatt? Brukes for å utelate tomme snapshots. */
export function hasKnowledge(s: KnowledgeSnapshot): boolean {
	return !!s.notes || s.interests.length > 0 || s.goals.length > 0;
}

export interface QuizResult {
	player: string;
	correct: boolean;
}

export interface QuizStanding {
	name: string;
	score: number;
	streak: number;
	bestStreak: number;
	streakLabel: string | null;
	current: boolean; // er det denne spillerens tur nå?
}

export interface QuizBoardView {
	active: boolean;
	theme: string | null;
	round: number;
	currentPlayer: string | null;
	currentQuestion: string | null;
	answered: boolean; // gjeldende spørsmål er besvart (da kan fasit vises)
	answer: string | null; // fasit — kun når besvart, ellers skjult
	lastResult: QuizResult | null;
	standings: QuizStanding[];
}

export interface QuizSessionState {
	participants: QuizParticipant[];
	theme: string | null;
	round: number;
	active: boolean;
	currentPlayer: string | null;
	currentQuestion: string | null;
	currentAnswer: string | null;
	lastResult: QuizResult | null;
	questionState?: string | null; // 'open' | 'answered' | null (bank-flyten)
}

/**
 * Projiser en quiz-sesjon til det skjermen viser. Holder fasiten (`answer`) SKJULT til
 * spørsmålet er besvart (`questionState === 'answered'`, ev. `lastResult` satt for eldre
 * rader) — slik at en delt skjerm i baksetet ikke røper svaret før noen har gjettet.
 * Ren, så gatingen kan enhetstestes. Board-skjemaet er UENDRET (Ekko-kontrakten).
 */
export function projectQuizBoard(session: QuizSessionState): QuizBoardView {
	const answered = session.questionState === 'answered' || session.lastResult != null;
	const currentName = (session.currentPlayer ?? '').trim().toLowerCase();
	const standings: QuizStanding[] = buildStandings(session.participants).map((p) => ({
		name: p.name,
		score: p.score,
		streak: p.streak,
		bestStreak: p.bestStreak,
		streakLabel: streakLabel(p.streak),
		current: !!currentName && p.name.toLowerCase() === currentName
	}));
	return {
		active: session.active,
		theme: session.theme,
		round: session.round,
		currentPlayer: session.currentPlayer,
		currentQuestion: session.currentQuestion,
		answered,
		answer: answered ? session.currentAnswer : null,
		lastResult: session.lastResult,
		standings
	};
}

/** Map en lagret quiz-sesjon (DB-rad) til den rene tilstanden board-projeksjonen forventer. */
export function toQuizSessionState(row: {
	participants: QuizParticipant[] | null;
	theme: string | null;
	round: number;
	active: boolean;
	currentPlayer: string | null;
	currentQuestion: string | null;
	currentAnswer: string | null;
	lastResult: QuizResult | null;
	questionState?: string | null;
}): QuizSessionState {
	return {
		participants: row.participants ?? [],
		theme: row.theme,
		round: row.round,
		active: row.active,
		currentPlayer: row.currentPlayer,
		currentQuestion: row.currentQuestion,
		currentAnswer: row.currentAnswer,
		lastResult: row.lastResult ?? null,
		questionState: row.questionState ?? null
	};
}

export interface GeneratedQuestion {
	player: string;
	question: string;
	answer: string;
	category: string; // varierte kategorier innen temaet (f.eks. «geografi», «dyr»)
}

/**
 * Normaliser spørsmål generert av LLM-en (JSON). Aksepterer enten et toppnivå-array
 * eller `{ questions: [...] }`. Dropper poster som mangler player/question/answer;
 * manglende kategori får «generelt». Robust mot at modellen finner på ekstra felter
 * eller leverer halvgyldig JSON.
 */
export function parseGeneratedQuestions(raw: unknown): GeneratedQuestion[] {
	const arr = Array.isArray(raw)
		? raw
		: raw && typeof raw === 'object' && Array.isArray((raw as { questions?: unknown }).questions)
			? (raw as { questions: unknown[] }).questions
			: [];

	const out: GeneratedQuestion[] = [];
	for (const item of arr) {
		if (!item || typeof item !== 'object') continue;
		const o = item as Record<string, unknown>;
		const player = typeof o.player === 'string' ? o.player.trim() : '';
		const question = typeof o.question === 'string' ? o.question.trim() : '';
		const answer = typeof o.answer === 'string' ? o.answer.trim() : '';
		const category = (typeof o.category === 'string' ? o.category.trim() : '') || 'generelt';
		if (!player || !question || !answer) continue;
		out.push({ player, question, answer, category });
	}
	return out;
}
