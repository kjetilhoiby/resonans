import type { AssistantTool } from './tools';
import { db } from '$lib/db';
import { themes, persons, memories, goals, quizSessions } from '$lib/db/schema';
import { and, eq, desc, inArray, sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { openai } from '$lib/server/openai';
import { completionTuning } from './model-tuning';
import { tavilySearch } from '$lib/server/web/tavily';
import { osloDayKey, pickTripForDate, dayWindowInfo, type TripCandidate } from '$lib/server/trip-geo';
import {
	ageFromBirthDate,
	ageBand,
	participantsFromEntries,
	coercePlayerEntries,
	findParticipantIndex,
	hasPendingAnswer,
	applyAnswer,
	buildStandings,
	streakLabel,
	parseGeneratedQuestions,
	filterRepeatQuestions,
	normalizeQuestionText,
	nextUnusedQuestion,
	markQuestionUsed,
	unusedCounts,
	nextPlayerName,
	buildKnowledgeSnapshot,
	hasKnowledge,
	projectQuizBoard,
	toQuizSessionState,
	type QuizParticipant,
	type QuizBankQuestion,
	type QuizPlayerEntry,
	type AgeBand,
	type KnowledgeSnapshot
} from './quiz-logic';

/** Minne-kategorier som er trygge og morsomme å bygge spørsmål av (utelater helse/psyke). */
const INTEREST_MEMORY_CATEGORIES = ['preferences', 'personal', 'relationship', 'fitness', 'other'];
const MEMORIES_PER_PERSON = 3;
const GOALS_PER_PERSON = 2;

/**
 * Quiz-verktøy for tale-assistentens bilferie-quizmaster — omlagt etter brukertesten i full bil
 * (se docs/changelog/2026-07-03-quiz-brukertest-fikser.md og QUIZ_AGENT_SPEC.md i resonans-lab):
 *
 *   - `trip_companions`: hvem som er med på reisen + alder + interesse-snapshot. Kalles ved
 *      quiz-start så laget kan FORESLÅS — det arves aldri implisitt fra forrige quiz.
 *   - `quiz_score action="start"`: fersk quiz med TOM deltakerliste (forrige deaktiveres).
 *   - `quiz_score action="register"`: hele laget som ETT array av {name, age, interests}.
 *   - `quiz_score action="prepare"`: batch-generer spørsmålsbanken per spiller med den STERKE
 *      modellen (alderstilpasset, personlig, varierte kategorier) — utenfor tur-stien. Refill
 *      ekskluderer en normalisert logg over alt som er stilt i brukerens siste quizer.
 *   - `quiz_score action="next"`: TREKK neste ubrukte bank-spørsmål (ingen generering i turen).
 *   - `quiz_score action="record"`: idempotent vurdering nøklet på spørsmåls-id — evaluer →
 *      poeng → answered → bytt tur som ÉN betinget UPDATE. Allerede besvart re-vurderes aldri.
 *
 * Tracking-state ligger i `quiz_sessions` (én aktiv quiz per bruker). Den rene logikken
 * (scoring/streaks/alder/bank/rotasjon) bor i `quiz-logic.ts` og er enhetstestet.
 */

/* ── trip_companions ──────────────────────────────────────────────────────────────────────── */

interface CompanionMember {
	name: string;
	age: number | null;
	band: AgeBand;
	role: 'voksen' | 'barn' | null;
	knowledge?: KnowledgeSnapshot; // interesser/kunnskap når personen er kjent
}

/** Finn det reise-temaet hvis vindu dekker en gitt dato — sjekker både ferie- og tripProfile. */
function pickActiveTrip(
	rows: Array<{
		id: string;
		ferieProfile: typeof themes.$inferSelect.ferieProfile;
		tripProfile: typeof themes.$inferSelect.tripProfile;
	}>,
	dateKey: string
): string | null {
	const candidates: TripCandidate[] = [];
	for (const r of rows) {
		const f = r.ferieProfile;
		if (f?.startDate && f?.endDate) candidates.push({ id: r.id, startDate: f.startDate, endDate: f.endDate });
		const t = r.tripProfile;
		if (t?.startDate && t?.endDate) candidates.push({ id: r.id, startDate: t.startDate, endDate: t.endDate });
	}
	return pickTripForDate(candidates, dateKey);
}

/**
 * Batch-hent alder + interesse-snapshot for et sett personer. Tre spørringer totalt
 * (persons, minner, mål) — ingen N+1. Returnerer kart personId → { age, snapshot }.
 */
async function loadKnowledge(
	userId: string,
	personIds: string[],
	today: Date
): Promise<Map<string, { age: number | null; snapshot: KnowledgeSnapshot }>> {
	const out = new Map<string, { age: number | null; snapshot: KnowledgeSnapshot }>();
	if (personIds.length === 0) return out;

	const [people, mems, gls] = await Promise.all([
		db
			.select({ id: persons.id, birthDate: persons.birthDate, notes: persons.notes })
			.from(persons)
			.where(and(eq(persons.userId, userId), inArray(persons.id, personIds))),
		db
			.select({ personId: memories.personId, content: memories.content, category: memories.category })
			.from(memories)
			.where(
				and(
					eq(memories.userId, userId),
					inArray(memories.personId, personIds),
					inArray(memories.category, INTEREST_MEMORY_CATEGORIES)
				)
			)
			.orderBy(desc(memories.createdAt)),
		db
			.select({ personId: goals.personId, title: goals.title })
			.from(goals)
			.where(and(eq(goals.userId, userId), inArray(goals.personId, personIds), eq(goals.status, 'active')))
			.orderBy(desc(goals.createdAt))
	]);

	// Grupper minne-innhold og mål-titler per person (allerede sortert nyeste først).
	const memByPerson = new Map<string, string[]>();
	for (const m of mems) {
		if (!m.personId) continue;
		const list = memByPerson.get(m.personId) ?? [];
		if (list.length < MEMORIES_PER_PERSON) list.push(m.content);
		memByPerson.set(m.personId, list);
	}
	const goalByPerson = new Map<string, string[]>();
	for (const g of gls) {
		if (!g.personId) continue;
		const list = goalByPerson.get(g.personId) ?? [];
		if (list.length < GOALS_PER_PERSON) list.push(g.title);
		goalByPerson.set(g.personId, list);
	}

	for (const p of people) {
		out.set(p.id, {
			age: ageFromBirthDate(p.birthDate, today),
			snapshot: buildKnowledgeSnapshot({
				notes: p.notes,
				memories: memByPerson.get(p.id) ?? [],
				goals: goalByPerson.get(p.id) ?? []
			})
		});
	}
	return out;
}

async function loadCompanions(userId: string): Promise<{
	trip: { id: string; name: string; destination?: string; dayNo?: number; totalDays?: number } | null;
	participants: CompanionMember[];
	note?: string;
}> {
	const today = new Date();
	const dateKey = osloDayKey(today);

	const rows = await db.query.themes.findMany({
		where: and(eq(themes.userId, userId), eq(themes.archived, false)),
		columns: { id: true, name: true, ferieProfile: true, tripProfile: true }
	});

	const activeId = pickActiveTrip(rows, dateKey);
	if (!activeId) {
		return { trip: null, participants: [], note: 'Ingen pågående reise akkurat nå. Spør hvem som er med.' };
	}

	const theme = rows.find((r) => r.id === activeId)!;
	const members = theme.ferieProfile?.members ?? [];

	// Research om deltakerne: alder + interesser/kunnskap for medlemmer knyttet til en person.
	const personIds = members.map((m) => m.personId).filter((id): id is string => !!id);
	const knowledge = await loadKnowledge(userId, personIds, today);

	const participants: CompanionMember[] = members.map((m) => {
		const k = m.personId ? knowledge.get(m.personId) : undefined;
		const age = k?.age ?? null;
		const snapshot = k?.snapshot;
		return {
			name: m.name,
			age,
			band: ageBand(age),
			role: m.role ?? null,
			knowledge: snapshot && hasKnowledge(snapshot) ? snapshot : undefined
		};
	});

	// Geo-vindu for «dag X av Y» når ferieprofilen har et vindu.
	const f = theme.ferieProfile;
	const window =
		f?.startDate && f?.endDate ? dayWindowInfo(f.startDate, f.endDate, dateKey) : null;

	return {
		trip: {
			id: theme.id,
			name: theme.name,
			destination: theme.tripProfile?.destination ?? f?.note,
			dayNo: window?.dayNo,
			totalDays: window?.totalDays
		},
		participants,
		note: participants.length === 0 ? 'Reisen har ingen registrerte deltakere. Spør hvem som er med.' : undefined
	};
}

/* ── Spørsmålsbank: batch-generering (sterk modell, utenfor tur-stien) ────────────────────── */

/**
 * Banken genereres med en STERK modell (samme tier som fortelleren) — det er et engangs
 * batch-kall ved bekreftet lag, ikke i tur-stien. Spilleturene selv kjøres på den raske
 * prat-modellen (se `hasActiveQuiz` + rutingen i assistant.ts).
 */
const DEFAULT_QUIZ_GEN_MODEL = 'gpt-5.5';
const quizGenModel = () => env.EKKO_QUIZ_GEN_MODEL?.trim() || DEFAULT_QUIZ_GEN_MODEL;
/** Romslig fordi reasoning-tokens trekkes av samme budsjett (jf. STORY_MAX_TOKENS). */
const QUIZ_GEN_MAX_TOKENS = 8000;
const QUIZ_GEN_TEMPERATURE = 0.8;

/** Spørsmål per spiller i en bank-batch (kontrakten sier 8–10). */
const DEFAULT_QUESTIONS_PER_PLAYER = 8;
const MAX_QUESTIONS_PER_PLAYER = 10;
/** Gjentakelses-vern: hvor mange av brukerens siste quizer asked-loggen hentes fra. */
const ASKED_LOG_QUIZ_LOOKBACK = 5;
/** Tak på asked-loggen per quiz (eldste kuttes) og på eksklusjonslista i prompten. */
const ASKED_LOG_MAX = 500;
const EXCLUSION_PROMPT_MAX = 80;

const BAND_GUIDANCE: Record<AgeBand, string> = {
	småbarn: 'svært enkelt (farger, dyrelyder, telle til ti, hverdagsord)',
	barn: 'enkelt til middels (pluss/gange små tall, dyr, kjente land og hovedsteder, enkle engelske gloser)',
	ungdom: 'middels (gangetabell og hoderegning, geografi, engelske ord, allmennkunnskap)',
	voksen: 'krevende (vanskelig geografi, årstall, ordforklaringer, detaljer)'
};

/** Hent korte fakta-snutter for et tema når banken skal bygges på ferske/nisje-fakta. */
async function gatherFacts(theme: string): Promise<string[]> {
	const hits = await tavilySearch(`fakta om ${theme}`, { maxResults: 5, searchDepth: 'basic' });
	return hits
		.map((h) => (h.content || h.rawContent || '').replace(/\s+/g, ' ').trim())
		.filter((t) => t.length > 0)
		.map((t) => t.slice(0, 500))
		.slice(0, 4);
}

/**
 * Generer en bank-batch: `perPlayer` spørsmål til HVER deltaker, alderstilpasset og personlig,
 * med varierte kategorier innen temaet. `excluded` (normaliserte, allerede stilte spørsmål)
 * legges i prompten som hint OG håndheves hardt med `filterRepeatQuestions` etterpå.
 */
async function generateBank(
	theme: string,
	participants: QuizParticipant[],
	perPlayer: number,
	excluded: Set<string>,
	freshFacts: boolean
): Promise<QuizBankQuestion[]> {
	let facts: string[] = [];
	if (freshFacts) {
		try {
			facts = await gatherFacts(theme);
		} catch (error) {
			console.warn('[quiz] research feilet, faller tilbake på modellkunnskap:', error);
		}
	}

	const roster = participants
		.map((p) => {
			const age = p.age ?? null;
			const alder = age != null ? `${age} år` : 'ukjent alder';
			const interests = p.interests ?? [];
			const liker = interests.length > 0 ? ` — liker/kan: ${interests.join(', ')}` : '';
			return `- ${p.name} (${alder}): ${BAND_GUIDANCE[ageBand(age)]}${liker}`;
		})
		.join('\n');

	const factsBlock =
		facts.length > 0
			? `\nFaktagrunnlag (bruk KUN dette for fakta, ikke dikt opp noe utover det):\n${facts.map((f) => `- ${f}`).join('\n')}\n`
			: '';

	const exclusionBlock =
		excluded.size > 0
			? `\nDisse spørsmålene er allerede stilt (normalisert form) — IKKE lag noe likt eller nesten likt:\n${[...excluded].slice(-EXCLUSION_PROMPT_MAX).map((q) => `- ${q}`).join('\n')}\n`
			: '';

	const prompt = `Tema: ${theme}
Lag ${perPlayer} spørsmål til HVER av disse spillerne, tilpasset alder/nivå:
${roster}
${factsBlock}${exclusionBlock}
Krav:
- Spørsmål og svar på norsk.
- Tilpass vanskelighetsgraden TYDELIG til hver spillers nivå — en 7-åring og en 42-åring skal
  merke forskjell selv innen samme tema. Aldri samme spørsmål til to spillere.
- Når en spiller har «liker/kan»-interesser, vri gjerne spørsmålet mot dem for å gjøre det
  personlig (men hold deg til temaet og ikke tving det hvis det blir søkt).
- Varier kategoriene innen temaet (f.eks. geografi, dyr, tall, språk, historie) og sett
  «category» på hvert spørsmål — ikke ti varianter av samme type.
- Korte spørsmål som egner seg for høytlesing i en bil. Ett tydelig, kort fasitsvar per spørsmål.
- Ikke dikt opp fakta. Er du usikker på en faktaopplysning, velg et tryggere spørsmål.
Returner JSON: { "questions": [ { "player": "<navn>", "question": "<spørsmål>", "answer": "<kort fasit>", "category": "<kategori>" } ] }`;

	const genModel = quizGenModel();
	const completion = await openai.chat.completions.create({
		model: genModel,
		messages: [
			{
				role: 'system',
				content:
					'Du er en lun, leken norsk quizmaster for en familie på bilferie. Du lager alderstilpassede spørsmål med korte, presise fasitsvar, og dikter aldri opp fakta.'
			},
			{ role: 'user', content: prompt }
		],
		response_format: { type: 'json_object' },
		...completionTuning(genModel, QUIZ_GEN_MAX_TOKENS, QUIZ_GEN_TEMPERATURE)
	});

	const content = completion.choices[0]?.message?.content ?? '';
	let parsed: unknown = null;
	try {
		parsed = JSON.parse(content);
	} catch {
		parsed = null;
	}

	// Hard håndheving: kun kjente spillere (kanonisk navn fra rosteret), ingen gjentakelser,
	// maks perPlayer per spiller. Id-ene settes her — det er dem vurderingen nøkles på.
	const fresh = filterRepeatQuestions(parseGeneratedQuestions(parsed), excluded);
	const perPlayerCount = new Map<string, number>();
	const bank: QuizBankQuestion[] = [];
	for (const q of fresh) {
		const idx = findParticipantIndex(participants, q.player);
		if (idx === -1) continue;
		const canonical = participants[idx].name;
		const count = perPlayerCount.get(canonical) ?? 0;
		if (count >= perPlayer) continue;
		perPlayerCount.set(canonical, count + 1);
		bank.push({
			id: crypto.randomUUID(),
			player: canonical,
			text: q.question,
			answer: q.answer,
			category: q.category,
			used: false
		});
	}
	return bank;
}

/* ── quiz_score: sesjons-tilstand ─────────────────────────────────────────────────────────── */

async function loadActiveSession(userId: string) {
	const rows = await db
		.select()
		.from(quizSessions)
		.where(and(eq(quizSessions.userId, userId), eq(quizSessions.active, true)))
		.limit(1);
	return rows[0] ?? null;
}

/**
 * Rask, billig ruting-signal for assistent-løkka: har brukeren en aktiv quiz, kjøres
 * spilleturene på den raske prat-modellen (batch-genereringen bruker den sterke — se
 * `generateBank`). Best-effort: må aldri kaste videre.
 */
export async function hasActiveQuiz(userId: string): Promise<boolean> {
	try {
		const rows = await db
			.select({ id: quizSessions.id })
			.from(quizSessions)
			.where(and(eq(quizSessions.userId, userId), eq(quizSessions.active, true)))
			.limit(1);
		return !!rows[0];
	} catch (error) {
		console.warn('[quiz] hasActiveQuiz feilet — ruter som vanlig tur:', error);
		return false;
	}
}

function standingsView(participants: QuizParticipant[]) {
	return buildStandings(participants).map((p) => ({
		name: p.name,
		score: p.score,
		streak: p.streak,
		bestStreak: p.bestStreak,
		streakLabel: streakLabel(p.streak)
	}));
}

/** Talevennlig lag-liste («Erle 7 år, Nils 9 år og Kjetil 42 år») til opplesing. */
function rosterReadback(participants: QuizParticipant[]): string {
	const parts = participants.map((p) => (p.age != null ? `${p.name} ${p.age} år` : p.name));
	if (parts.length <= 1) return parts[0] ?? '';
	return `${parts.slice(0, -1).join(', ')} og ${parts[parts.length - 1]}`;
}

/**
 * Start en FERSK quiz med TOM deltakerliste. En eventuell pågående quiz deaktiveres — deltakere
 * (og bank/poeng) arves ALDRI implisitt til den nye. «Samme lag som sist» skjer kun ved at
 * modellen registrerer laget eksplisitt etter bekreftelse fra brukeren.
 */
async function startSession(userId: string, theme?: string) {
	await db
		.update(quizSessions)
		.set({ active: false, updatedAt: new Date() })
		.where(and(eq(quizSessions.userId, userId), eq(quizSessions.active, true)));
	const inserted = await db
		.insert(quizSessions)
		.values({
			userId,
			participants: [],
			theme: theme?.trim() || null,
			round: 0,
			active: true,
			currentPlayer: null,
			currentQuestion: null,
			currentAnswer: null,
			lastResult: null,
			currentQuestionId: null,
			questionState: null,
			questionBank: [],
			askedLog: []
		})
		.returning({ id: quizSessions.id });

	return {
		sessionId: inserted[0]?.id,
		participants: [],
		note: 'Fersk quiz uten deltakere. Foreslå laget fra trip_companions og registrer det de bekrefter med action="register" (hele laget i ETT kall).'
	};
}

/**
 * Registrer HELE laget som ett array av {name, age, interests}. Erstatter rosteret, men
 * bevarer poeng/streaks for navn som allerede står der (så en sen-registrering av en ny
 * spiller midt i quizen ikke nuller de andre).
 */
async function registerPlayers(userId: string, entries: QuizPlayerEntry[]) {
	const session = await loadActiveSession(userId);
	if (!session) return { error: 'Ingen aktiv quiz. Start en med action="start" først.' };

	const fresh = participantsFromEntries(entries);
	if (fresh.length === 0) return { error: 'Oppgi minst én spiller i players ({name, age}).' };

	const existing = session.participants ?? [];
	const participants = fresh.map((p) => {
		const idx = findParticipantIndex(existing, p.name);
		return idx >= 0 ? { ...existing[idx], age: p.age ?? existing[idx].age, interests: p.interests ?? existing[idx].interests } : p;
	});

	// Forsvinner spilleren med åpent spørsmål ut av rosteret, nullstill tur-tilstanden.
	const currentGone =
		session.currentPlayer != null && findParticipantIndex(participants, session.currentPlayer) === -1;

	await db
		.update(quizSessions)
		.set({
			participants,
			...(currentGone
				? { currentPlayer: null, currentQuestion: null, currentAnswer: null, currentQuestionId: null, questionState: null, lastResult: null }
				: {}),
			updatedAt: new Date()
		})
		.where(eq(quizSessions.id, session.id));

	return {
		participants: participants.map((p) => ({ name: p.name, age: p.age ?? null })),
		readBack: rosterReadback(participants),
		note: 'Les hele laget med alder tilbake til brukeren før første spørsmål. Bygg så banken med action="prepare" (theme).'
	};
}

/** Normaliserte spørsmål stilt i brukerens siste quizer + alt som alt ligger i banken. */
async function loadExclusionSet(userId: string, currentBank: QuizBankQuestion[]): Promise<Set<string>> {
	const excluded = new Set<string>();
	try {
		const rows = await db
			.select({ askedLog: quizSessions.askedLog })
			.from(quizSessions)
			.where(eq(quizSessions.userId, userId))
			.orderBy(desc(quizSessions.createdAt))
			.limit(ASKED_LOG_QUIZ_LOOKBACK);
		for (const row of rows) {
			for (const q of row.askedLog ?? []) excluded.add(q);
		}
	} catch (error) {
		// Gjentakelses-vern på tvers av quizer er best-effort — banken kan fortsatt bygges.
		console.warn('[quiz] kunne ikke lese asked-logg fra tidligere quizer:', error);
	}
	for (const q of currentBank) excluded.add(normalizeQuestionText(q.text));
	return excluded;
}

/**
 * Bygg (eller etterfyll) spørsmålsbanken for det bekreftede laget. Kalles ved quiz-start etter
 * registrering, og igjen som refill når banken går tom — aldri i selve tur-stien.
 */
async function prepareBank(
	userId: string,
	theme: string,
	perPlayerRaw: number | undefined,
	freshFacts: boolean
) {
	const session = await loadActiveSession(userId);
	if (!session) return { error: 'Ingen aktiv quiz. Start en med action="start" først.' };
	const participants = session.participants ?? [];
	if (participants.length === 0) {
		return { error: 'Ingen spillere registrert. Registrer laget med action="register" først.' };
	}

	const perPlayer =
		typeof perPlayerRaw === 'number' && perPlayerRaw > 0
			? Math.min(Math.floor(perPlayerRaw), MAX_QUESTIONS_PER_PLAYER)
			: DEFAULT_QUESTIONS_PER_PLAYER;

	const existingBank = session.questionBank ?? [];
	const excluded = await loadExclusionSet(userId, existingBank);

	let batch: QuizBankQuestion[];
	try {
		batch = await generateBank(theme, participants, perPlayer, excluded, freshFacts);
	} catch (error) {
		console.error('[quiz] kunne ikke generere spørsmålsbank:', error);
		return { error: 'Klarte ikke å lage spørsmålsbank akkurat nå. Prøv igjen.' };
	}
	if (batch.length === 0) {
		return { error: 'Genereringen ga ingen brukbare spørsmål. Prøv igjen, gjerne med et annet tema.' };
	}

	const bank = [...existingBank, ...batch];
	await db
		.update(quizSessions)
		.set({ theme: theme, questionBank: bank, updatedAt: new Date() })
		.where(eq(quizSessions.id, session.id));

	const added: Record<string, number> = {};
	for (const q of batch) added[q.player] = (added[q.player] ?? 0) + 1;

	return {
		ok: true,
		theme,
		added,
		unused: unusedCounts(bank),
		note: 'Banken er klar. Trekk spørsmål med action="next" — ikke finn på egne spørsmål.'
	};
}

/**
 * Trekk neste ubrukte bank-spørsmål og sett det som gjeldende (åpent) — dette er hele
 * tur-stien, ingen generering her. Verktøyet velger spiller ved tur-rotasjon når `player`
 * ikke er oppgitt. Fasiten returneres til modellen (skjules på skjermen til besvart).
 */
async function drawNextQuestion(userId: string, playerArg?: string) {
	const session = await loadActiveSession(userId);
	if (!session) return { error: 'Ingen aktiv quiz. Start en med action="start" først.' };
	const participants = session.participants ?? [];
	if (participants.length === 0) {
		return { error: 'Ingen spillere registrert. Registrer laget med action="register" først.' };
	}

	// Vakt: ikke trekk nytt spørsmål før forrige svar er bokført — ellers forsvinner poenget.
	if (hasPendingAnswer(session)) {
		const pending = session.currentPlayer ? ` til ${session.currentPlayer}` : '';
		return {
			error: `Gjeldende spørsmål${pending} er ikke vurdert ennå. Kall quiz_score action="record" (questionId="${session.currentQuestionId ?? ''}" + correct) før du trekker neste.`
		};
	}

	// Tur-rotasjon: eksplisitt spiller > spilleren record roterte til > første deltaker.
	let target: string;
	if (playerArg && playerArg.trim()) {
		const idx = findParticipantIndex(participants, playerArg);
		if (idx === -1) {
			return { error: `Ukjent spiller «${playerArg}». Aktive spillere: ${participants.map((p) => p.name).join(', ')}.` };
		}
		target = participants[idx].name;
	} else {
		const idx = session.currentPlayer ? findParticipantIndex(participants, session.currentPlayer) : -1;
		target = idx >= 0 ? participants[idx].name : (nextPlayerName(participants, null) as string);
	}

	const bank = session.questionBank ?? [];
	const question = nextUnusedQuestion(bank, target);
	if (!question) {
		return {
			error: `Tomt for spørsmål til ${target}. Etterfyll banken med action="prepare" (theme) — den hopper over alt som er stilt før.`,
			unused: unusedCounts(bank)
		};
	}

	const askedLog = [...(session.askedLog ?? []), normalizeQuestionText(question.text)].slice(-ASKED_LOG_MAX);

	// Betinget UPDATE: taper mot et samtidig trekk/åpent spørsmål i stedet for å overskrive det.
	const updated = await db
		.update(quizSessions)
		.set({
			questionBank: markQuestionUsed(bank, question.id),
			askedLog,
			currentPlayer: target,
			currentQuestion: question.text,
			currentAnswer: question.answer,
			currentQuestionId: question.id,
			questionState: 'open',
			lastResult: null,
			updatedAt: new Date()
		})
		.where(and(eq(quizSessions.id, session.id), sql`${quizSessions.questionState} IS DISTINCT FROM 'open'`))
		.returning({ id: quizSessions.id });
	if (updated.length === 0) {
		return { error: 'Et annet spørsmål ble nettopp åpnet. Kall action="status" og les gjeldende spørsmål.' };
	}

	const remaining = unusedCounts(markQuestionUsed(bank, question.id));
	return {
		questionId: question.id,
		player: target,
		question: question.text,
		answer: question.answer,
		category: question.category,
		remainingForPlayer: remaining[target] ?? 0,
		...((remaining[target] ?? 0) <= 1
			? { refillHint: 'Banken er nesten tom for denne spilleren — kall action="prepare" for påfyll ved neste anledning.' }
			: {})
	};
}

/**
 * Idempotent vurdering nøklet på spørsmåls-id: evaluer → poeng → marker answered → bytt
 * currentPlayer, alt som ÉN betinget UPDATE (statuskolonne-CAS — den serverless-vennlige
 * serialiseringen). Et allerede besvart spørsmål re-vurderes ALDRI: to raske svar («Riktig»,
 * så «Snø») gir nøyaktig én bokføring, og nummer to får «already graded» tilbake.
 */
async function recordAnswer(userId: string, questionId: string, correct: boolean) {
	const session = await loadActiveSession(userId);
	if (!session) return { error: 'Ingen aktiv quiz. Start en med action="start" først.' };

	const alreadyGraded = (s: typeof session) => ({
		alreadyGraded: true,
		note: 'Dette spørsmålet er allerede vurdert — IKKE vurder det på nytt. Kvitter kort og les gjeldende spørsmål en gang til.',
		currentPlayer: s.currentPlayer,
		currentQuestion: s.currentQuestion,
		currentQuestionId: s.currentQuestionId,
		standings: standingsView(s.participants ?? [])
	});

	if (session.currentQuestionId !== questionId || session.questionState !== 'open') {
		// Kjent, brukt bank-spørsmål som ikke lenger er åpent ⇒ allerede vurdert (idempotens).
		const known = (session.questionBank ?? []).find((q) => q.id === questionId);
		if (known?.used) return alreadyGraded(session);
		return { error: `Ukjent questionId «${questionId}». Gjeldende spørsmål har id «${session.currentQuestionId ?? 'ingen'}».` };
	}

	const participants = session.participants ?? [];
	const bankItem = (session.questionBank ?? []).find((q) => q.id === questionId);
	const playerName = bankItem?.player ?? session.currentPlayer ?? '';
	const idx = findParticipantIndex(participants, playerName);
	if (idx === -1) {
		return { error: `Spilleren «${playerName}» for spørsmålet finnes ikke i laget. Registrer laget på nytt med action="register".` };
	}

	const updated = [...participants];
	updated[idx] = applyAnswer(updated[idx], correct);
	const nextPlayer = nextPlayerName(updated, updated[idx].name);

	// CAS: vinner bare hvis spørsmålet fortsatt er åpent. Taper vi (parallell tur), er svaret
	// allerede bokført av noen andre — da svarer vi «already graded» i stedet for å telle dobbelt.
	const won = await db
		.update(quizSessions)
		.set({
			participants: updated,
			lastResult: { player: updated[idx].name, correct }, // avslører fasiten på skjermen
			questionState: 'answered',
			currentPlayer: nextPlayer,
			updatedAt: new Date()
		})
		.where(
			and(
				eq(quizSessions.id, session.id),
				eq(quizSessions.currentQuestionId, questionId),
				eq(quizSessions.questionState, 'open')
			)
		)
		.returning({ id: quizSessions.id });
	if (won.length === 0) {
		const reloaded = await loadActiveSession(userId);
		return alreadyGraded(reloaded ?? session);
	}

	const me = updated[idx];
	return {
		player: me.name,
		correct,
		score: me.score,
		streak: me.streak,
		streakLabel: streakLabel(me.streak),
		nextPlayer,
		standings: standingsView(updated)
	};
}

async function endSession(userId: string) {
	const session = await loadActiveSession(userId);
	if (!session) return { error: 'Ingen aktiv quiz å avslutte.' };
	await db.update(quizSessions).set({ active: false, updatedAt: new Date() }).where(eq(quizSessions.id, session.id));
	const standings = standingsView(session.participants ?? []);
	return { ended: true, winner: standings[0]?.name ?? null, standings };
}

/* ── Verktøy-definisjoner ─────────────────────────────────────────────────────────────────── */

export const QUIZ_ASSISTANT_TOOLS: AssistantTool[] = [
	{
		definition: {
			type: 'function',
			function: {
				name: 'trip_companions',
				description:
					'Hent deltakerne på den pågående reisen: navn, alder, voksen/barn, OG et kompakt interesse-/kunnskaps-snapshot per person (hva de liker og holder på med). Bruk ved quiz-start for å FORESLÅ laget (det arves aldri automatisk), og for andre reise-spill. Tom liste betyr ingen pågående reise eller ingen registrerte deltakere — spør da hvem som spiller.',
				parameters: { type: 'object', properties: {} }
			}
		},
		run: async (userId) => loadCompanions(userId)
	},
	{
		definition: {
			type: 'function',
			function: {
				name: 'quiz_score',
				description:
					'Kjør bilferie-quizen og driv spill-skjermen. Flyt: action="start" oppretter en FERSK quiz med tom deltakerliste (en gammel quiz deaktiveres — ingen spillere arves). action="register" (players: HELE laget som ett array av {name, age, interests}) registrerer spillerne — parse «Erle 7, Nils 9 og Kjetil 42» til ETT kall. action="prepare" (theme) bygger en alderstilpasset spørsmålsbank per spiller — kalles ved bekreftet lag og som påfyll når banken går tom. action="next" trekker neste ubrukte spørsmål fra banken (verktøyet roterer turen; fasiten følger med) — kall RETT FØR du leser spørsmålet høyt. action="record" (questionId + correct) bokfører svaret idempotent — allerede vurderte spørsmål re-vurderes aldri. action="status" gir stilling og gjeldende spørsmål; action="end" avslutter og kårer vinneren.',
				parameters: {
					type: 'object',
					properties: {
						action: { type: 'string', enum: ['start', 'register', 'prepare', 'next', 'record', 'status', 'end'] },
						theme: { type: 'string', description: 'Tema for banken, f.eks. «hovedsteder», «dyr», «blandet» (for start/prepare)' },
						players: {
							type: 'array',
							description: 'HELE laget i ett kall (for action="register") — alder styrer vanskelighetsgraden',
							items: {
								type: 'object',
								properties: {
									name: { type: 'string' },
									age: { type: 'number', description: 'Alder i år (utelat om ukjent — da behandles som voksen)' },
									interests: {
										type: 'array',
										items: { type: 'string' },
										description: 'Hva spilleren liker/kan (fra trip_companions) — gjør bank-spørsmålene personlige'
									}
								},
								required: ['name']
							}
						},
						questionsPerPlayer: { type: 'number', description: 'Spørsmål per spiller i banken, default 8 (for action="prepare")' },
						freshFacts: { type: 'boolean', description: 'true = websøk for ferske/nisje-fakta før banken bygges (for action="prepare")' },
						player: { type: 'string', description: 'Overstyr hvem som får neste spørsmål (for action="next"; default tur-rotasjon)' },
						questionId: { type: 'string', description: 'Id-en til spørsmålet som vurderes (for action="record") — fra next' },
						correct: { type: 'boolean', description: 'Var svaret riktig? (for action="record")' }
					},
					required: ['action']
				}
			}
		},
		run: async (userId, args) => {
			const action = typeof args.action === 'string' ? args.action : '';
			switch (action) {
				case 'start': {
					const theme = typeof args.theme === 'string' ? args.theme : undefined;
					return startSession(userId, theme);
				}
				case 'register':
					return registerPlayers(userId, coercePlayerEntries(args.players));
				case 'prepare': {
					const theme = typeof args.theme === 'string' ? args.theme.trim() : '';
					if (!theme) return { error: 'Oppgi et tema (theme).' };
					const perPlayer = typeof args.questionsPerPlayer === 'number' ? args.questionsPerPlayer : undefined;
					return prepareBank(userId, theme, perPlayer, args.freshFacts === true);
				}
				case 'next': {
					const player = typeof args.player === 'string' ? args.player : undefined;
					return drawNextQuestion(userId, player);
				}
				case 'record': {
					const questionId = typeof args.questionId === 'string' ? args.questionId.trim() : '';
					if (!questionId) return { error: 'Oppgi questionId (fra action="next").' };
					if (typeof args.correct !== 'boolean') return { error: 'Oppgi correct (true/false).' };
					return recordAnswer(userId, questionId, args.correct);
				}
				case 'status': {
					const session = await loadActiveSession(userId);
					if (!session) return { active: false };
					return {
						...projectQuizBoard(toQuizSessionState(session)),
						currentQuestionId: session.currentQuestionId,
						questionState: session.questionState,
						unused: unusedCounts(session.questionBank ?? [])
					};
				}
				case 'end':
					return endSession(userId);
				default:
					return { error: 'Ukjent action. Bruk start, register, prepare, next, record, status eller end.' };
			}
		}
	}
];
