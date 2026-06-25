import type { AssistantTool } from './tools';
import { db } from '$lib/db';
import { themes, persons, quizSessions } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { openai } from '$lib/server/openai';
import { tavilySearch } from '$lib/server/web/tavily';
import { osloDayKey, pickTripForDate, dayWindowInfo, type TripCandidate } from '$lib/server/trip-geo';
import {
	ageFromBirthDate,
	ageBand,
	participantsFromNames,
	findParticipantIndex,
	applyAnswer,
	buildStandings,
	streakLabel,
	parseGeneratedQuestions,
	type QuizParticipant,
	type AgeBand
} from './quiz-logic';

/**
 * Quiz-verktøy for tale-assistentens bilferie-quizmaster.
 *
 * Den rene konversasjonelle quizen kan modellen kjøre selv — disse verktøyene dekker det den
 * IKKE gjør pålitelig alene:
 *   - `quiz_companions`: hent deltakere (med alder) fra den pågående reisen, så quizmasteren
 *      slipper å spørre «hvem er med».
 *   - `quiz_round`: lag ferske, faktasjekkede og aldersdifferensierte spørsmål (Tavily-research
 *      når temaet trenger det), og returner fasit så modellen aldri dikter opp svaret.
 *   - `quiz_score`: tell poeng og streaks per person, så «3 på rad — Nils er on fire!» blir sant.
 *
 * Tracking-state ligger i `quiz_sessions` (én aktiv quiz per bruker). Den rene logikken
 * (scoring/streaks/alder) bor i `quiz-logic.ts` og er enhetstestet.
 */

/* ── quiz_companions ──────────────────────────────────────────────────────────────────────── */

interface CompanionMember {
	name: string;
	age: number | null;
	band: AgeBand;
	role: 'voksen' | 'barn' | null;
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

	// Slå opp fødselsdato for medlemmer som er knyttet til en person.
	const personIds = members.map((m) => m.personId).filter((id): id is string => !!id);
	const birthByPerson = new Map<string, string | null>();
	if (personIds.length > 0) {
		const people = await db
			.select({ id: persons.id, birthDate: persons.birthDate })
			.from(persons)
			.where(and(eq(persons.userId, userId), inArray(persons.id, personIds)));
		for (const p of people) birthByPerson.set(p.id, p.birthDate);
	}

	const participants: CompanionMember[] = members.map((m) => {
		const birth = m.personId ? birthByPerson.get(m.personId) ?? null : null;
		const age = ageFromBirthDate(birth, today);
		return { name: m.name, age, band: ageBand(age), role: m.role ?? null };
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

/* ── quiz_round ───────────────────────────────────────────────────────────────────────────── */

interface RoundPlayer {
	name: string;
	age: number | null;
}

const BAND_GUIDANCE: Record<AgeBand, string> = {
	småbarn: 'svært enkelt (farger, dyrelyder, telle til ti, hverdagsord)',
	barn: 'enkelt til middels (pluss/gange små tall, dyr, kjente land og hovedsteder, enkle engelske gloser)',
	ungdom: 'middels (gangetabell og hoderegning, geografi, engelske ord, allmennkunnskap)',
	voksen: 'krevende (vanskelig geografi, årstall, ordforklaringer, detaljer)'
};

function coercePlayers(raw: unknown): RoundPlayer[] {
	if (!Array.isArray(raw)) return [];
	const out: RoundPlayer[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const o = item as Record<string, unknown>;
		const name = typeof o.name === 'string' ? o.name.trim() : '';
		if (!name) continue;
		const age = typeof o.age === 'number' && Number.isFinite(o.age) ? Math.round(o.age) : null;
		out.push({ name, age });
	}
	return out;
}

/** Hent korte fakta-snutter for et tema når quizmasteren ber om ferske/nisje-fakta. */
async function gatherFacts(theme: string): Promise<string[]> {
	const hits = await tavilySearch(`fakta om ${theme}`, { maxResults: 5, searchDepth: 'basic' });
	return hits
		.map((h) => (h.content || h.rawContent || '').replace(/\s+/g, ' ').trim())
		.filter((t) => t.length > 0)
		.map((t) => t.slice(0, 500))
		.slice(0, 4);
}

async function buildRound(
	theme: string,
	players: RoundPlayer[],
	questionsPerPlayer: number,
	freshFacts: boolean
): Promise<{ theme: string; questions: ReturnType<typeof parseGeneratedQuestions>; usedResearch: boolean }> {
	let facts: string[] = [];
	if (freshFacts) {
		try {
			facts = await gatherFacts(theme);
		} catch (error) {
			console.warn('[quiz] research feilet, faller tilbake på modellkunnskap:', error);
		}
	}

	const roster = players
		.map((p) => `- ${p.name} (${p.age != null ? `${p.age} år` : 'ukjent alder'}): ${BAND_GUIDANCE[ageBand(p.age)]}`)
		.join('\n');

	const factsBlock =
		facts.length > 0
			? `\nFaktagrunnlag (bruk KUN dette for fakta, ikke dikt opp noe utover det):\n${facts.map((f) => `- ${f}`).join('\n')}\n`
			: '';

	const prompt = `Tema: ${theme}
Lag ${questionsPerPlayer} spørsmål til HVER av disse spillerne, tilpasset alder/nivå:
${roster}
${factsBlock}
Krav:
- Spørsmål og svar på norsk.
- Tilpass vanskelighetsgraden til hver spillers nivå (samme tema kan ha ulik vanskelighet per spiller).
- Korte spørsmål som egner seg for høytlesing i en bil. Ett tydelig, kort fasitsvar per spørsmål.
- Ikke dikt opp fakta. Er du usikker på en faktaopplysning, velg et tryggere spørsmål.
Returner JSON: { "questions": [ { "player": "<navn>", "question": "<spørsmål>", "answer": "<kort fasit>" } ] }`;

	const completion = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: [
			{
				role: 'system',
				content:
					'Du er en lun, leken norsk quizmaster for en familie på bilferie. Du lager alderstilpassede spørsmål med korte, presise fasitsvar, og dikter aldri opp fakta.'
			},
			{ role: 'user', content: prompt }
		],
		response_format: { type: 'json_object' },
		temperature: 0.8,
		max_tokens: 800
	});

	const content = completion.choices[0]?.message?.content ?? '';
	let parsed: unknown = null;
	try {
		parsed = JSON.parse(content);
	} catch {
		parsed = null;
	}
	return { theme, questions: parseGeneratedQuestions(parsed), usedResearch: facts.length > 0 };
}

/* ── quiz_score ───────────────────────────────────────────────────────────────────────────── */

async function loadActiveSession(userId: string) {
	const rows = await db
		.select()
		.from(quizSessions)
		.where(and(eq(quizSessions.userId, userId), eq(quizSessions.active, true)))
		.limit(1);
	return rows[0] ?? null;
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

async function startSession(userId: string, names: string[]) {
	const participants = participantsFromNames(names);
	if (participants.length === 0) return { error: 'Oppgi minst én deltaker (names).' };

	// Maks én aktiv quiz per bruker — deaktiver forrige før vi starter en ny.
	await db.update(quizSessions).set({ active: false, updatedAt: new Date() }).where(and(eq(quizSessions.userId, userId), eq(quizSessions.active, true)));
	const inserted = await db
		.insert(quizSessions)
		.values({ userId, participants, round: 0, active: true })
		.returning({ id: quizSessions.id });

	return { sessionId: inserted[0]?.id, participants: participants.map((p) => p.name), standings: standingsView(participants) };
}

async function recordAnswer(userId: string, player: string, correct: boolean, theme?: string) {
	const session = await loadActiveSession(userId);
	if (!session) return { error: 'Ingen aktiv quiz. Start en med action="start" først.' };

	const participants = session.participants ?? [];
	const idx = findParticipantIndex(participants, player);
	if (idx === -1) {
		return { error: `Ukjent spiller «${player}». Aktive spillere: ${participants.map((p) => p.name).join(', ') || 'ingen'}.` };
	}

	const updated = [...participants];
	updated[idx] = applyAnswer(updated[idx], correct);

	await db
		.update(quizSessions)
		.set({ participants: updated, theme: theme ?? session.theme, updatedAt: new Date() })
		.where(eq(quizSessions.id, session.id));

	const me = updated[idx];
	return {
		player: me.name,
		correct,
		score: me.score,
		streak: me.streak,
		streakLabel: streakLabel(me.streak),
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
				name: 'quiz_companions',
				description:
					'Hent deltakerne på den pågående reisen (navn + alder + voksen/barn) så quizen kan starte uten å spørre «hvem er med». Bruk når brukeren vil starte quiz eller andre reise-spill. Tom liste betyr ingen pågående reise eller ingen registrerte deltakere — spør da hvem som spiller.',
				parameters: { type: 'object', properties: {} }
			}
		},
		run: async (userId) => loadCompanions(userId)
	},
	{
		definition: {
			type: 'function',
			function: {
				name: 'quiz_round',
				description:
					'Lag en runde aldersdifferensierte quiz-spørsmål for et tema, med fasit (så du aldri trenger å gjette svaret). Gir ett eller flere spørsmål per spiller, tilpasset hver spillers alder. Sett freshFacts=true for temaer som trenger ferske eller spesifikke fakta (favorittserie/-spill, dagsaktuell sport, et bestemt land) — da gjør verktøyet websøk først. La freshFacts stå false for tidløse temaer (mattestykker, enkel geografi, engelske gloser) som du kan trygt nok selv.',
				parameters: {
					type: 'object',
					properties: {
						theme: { type: 'string', description: 'Tema for runden, f.eks. «hovedsteder», «gangetabellen», «Bluey», «engelske dyr»' },
						participants: {
							type: 'array',
							description: 'Spillerne med alder (bruk quiz_companions for å hente dem)',
							items: {
								type: 'object',
								properties: {
									name: { type: 'string' },
									age: { type: 'number', description: 'Alder i år (utelat om ukjent — da behandles som voksen)' }
								},
								required: ['name']
							}
						},
						questionsPerPlayer: { type: 'number', description: 'Antall spørsmål per spiller, default 1' },
						freshFacts: { type: 'boolean', description: 'true = gjør websøk for ferske/nisje-fakta før spørsmålene lages' }
					},
					required: ['theme', 'participants']
				}
			}
		},
		run: async (userId, args) => {
			const theme = typeof args.theme === 'string' ? args.theme.trim() : '';
			if (!theme) return { error: 'Oppgi et tema.' };
			const players = coercePlayers(args.participants);
			if (players.length === 0) return { error: 'Oppgi minst én spiller i participants.' };
			const perPlayer = typeof args.questionsPerPlayer === 'number' && args.questionsPerPlayer > 0 ? Math.min(Math.floor(args.questionsPerPlayer), 5) : 1;
			const freshFacts = args.freshFacts === true;
			try {
				return await buildRound(theme, players, perPlayer, freshFacts);
			} catch (error) {
				console.error('[quiz] kunne ikke lage runde:', error);
				return { error: 'Klarte ikke å lage spørsmål akkurat nå.' };
			}
		}
	},
	{
		definition: {
			type: 'function',
			function: {
				name: 'quiz_score',
				description:
					'Hold poeng og streaks per spiller i en quiz. action="start" (med names) starter en ny quiz og nullstiller stillingen. action="record" registrerer ett svar (player + correct) og returnerer oppdatert stilling og streak — bruk svaret til å si f.eks. «tre på rad, on fire!». action="status" gir gjeldende stilling. action="end" avslutter og kårer vinneren. Registrer ETT svar per spiller per spørsmål.',
				parameters: {
					type: 'object',
					properties: {
						action: { type: 'string', enum: ['start', 'record', 'status', 'end'] },
						names: { type: 'array', items: { type: 'string' }, description: 'Deltakernavn (for action="start")' },
						player: { type: 'string', description: 'Hvem som svarte (for action="record")' },
						correct: { type: 'boolean', description: 'Var svaret riktig? (for action="record")' },
						theme: { type: 'string', description: 'Valgfritt tema for runden som spilles (record)' }
					},
					required: ['action']
				}
			}
		},
		run: async (userId, args) => {
			const action = typeof args.action === 'string' ? args.action : '';
			switch (action) {
				case 'start': {
					const names = Array.isArray(args.names) ? args.names.filter((n): n is string => typeof n === 'string') : [];
					return startSession(userId, names);
				}
				case 'record': {
					const player = typeof args.player === 'string' ? args.player : '';
					if (!player) return { error: 'Oppgi player.' };
					if (typeof args.correct !== 'boolean') return { error: 'Oppgi correct (true/false).' };
					const theme = typeof args.theme === 'string' ? args.theme.trim() || undefined : undefined;
					return recordAnswer(userId, player, args.correct, theme);
				}
				case 'status': {
					const session = await loadActiveSession(userId);
					if (!session) return { error: 'Ingen aktiv quiz.' };
					return { theme: session.theme, standings: standingsView(session.participants ?? []) };
				}
				case 'end':
					return endSession(userId);
				default:
					return { error: 'Ukjent action. Bruk start, record, status eller end.' };
			}
		}
	}
];
