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
	const seen = new Set<string>();
	const out: QuizParticipant[] = [];
	for (const raw of names) {
		const name = (raw ?? '').trim();
		if (!name) continue;
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(newParticipant(name));
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

export interface GeneratedQuestion {
	player: string;
	question: string;
	answer: string;
}

/**
 * Normaliser spørsmål generert av LLM-en (JSON). Aksepterer enten et toppnivå-array
 * eller `{ questions: [...] }`. Dropper poster som mangler player/question/answer.
 * Robust mot at modellen finner på ekstra felter eller leverer halvgyldig JSON.
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
		if (!player || !question || !answer) continue;
		out.push({ player, question, answer });
	}
	return out;
}
