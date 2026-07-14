import OpenAI from 'openai';
import { openai } from '$lib/server/openai';
import { env } from '$env/dynamic/private';
import type { ConversationTurn } from '$lib/server/conversation-window';
import { ASSISTANT_TOOL_DEFINITIONS, runAssistantTool } from './tools';
import { completionTuning } from './model-tuning';
import { hasActiveStory } from './story-tools';
import { hasActiveQuiz } from './quiz-tools';
import { getFullProgram } from '$lib/server/programs/repository';
import { localHm, localIsoDay } from '$lib/server/nudge-time';

/**
 * Server-kjørt, verktøy-bevisst samtaleagent for Ekko. Til forskjell fra den raske, statsløse
 * coachen eier serveren her en agent-løkke: LLM → verktøy → LLM → … til et endelig svar.
 * Klienten kjører ingen verktøy og ser bare sluttteksten.
 */

export class AssistantError extends Error {
	constructor(message: string, readonly cause?: unknown) {
		super(message);
		this.name = 'AssistantError';
	}
}

const DEFAULT_MODEL = 'gpt-4o';
const model = () => env.EKKO_ASSISTANT_MODEL?.trim() || DEFAULT_MODEL;

/**
 * Forteller-modus krever den sterke, ferske modellen (jf. forteller-kontrakten, punkt 8) — IKKE
 * den raske prat-tieren, som gir frikoblede, grunne avsnitt. Story-turer (en aktiv fortelling, eller
 * når et story_*-verktøy er brukt i turen) rutes derfor til en egen, sterkere modell. Knappen er en
 * env-variabel akkurat som EKKO_ASSISTANT_MODEL, så den er provider-uavhengig: et bytte til Claude
 * (Opus/Sonnet 4.x) senere er bare en annen modell-id her — ingen endringer i board-skjema/verktøy.
 */
const DEFAULT_STORY_MODEL = 'gpt-5.5';
const storyModel = () => env.EKKO_STORY_MODEL?.trim() || DEFAULT_STORY_MODEL;

/**
 * Spilleturer i quizen rutes til en RASK modell (brukertesten viste lang responstid per tur).
 * Signalet er billig: brukeren har en aktiv quiz (hasActiveQuiz), eller et quiz_-verktøy er
 * brukt i turen. Turene er mekaniske (trekk spørsmål, bokfør svar, les fasit/stilling) og
 * trenger ikke den sterke tieren — den brukes kun i bank-genereringen inne i
 * quiz_score action="prepare", utenfor tur-stien (se quiz-tools.ts).
 */
const DEFAULT_QUIZ_MODEL = 'gpt-4o-mini';
const quizModel = () => env.EKKO_QUIZ_MODEL?.trim() || DEFAULT_QUIZ_MODEL;
/**
 * Tak på completion-tokens for fortellinger. Romslig fordi GPT-5/reasoning-modeller bruker
 * (skjulte) reasoning-tokens AV samme budsjett — er det for knapt, kan svaret bli tomt/avkuttet,
 * og løkka går tom uten endelig tekst. Vanlige prat-turer beholder det stramme 600-taket.
 */
const STORY_MAX_TOKENS = 4000;
/** Litt høyere temperatur for fortellinger — kun for modeller som støtter egendefinert temperatur. */
const STORY_TEMPERATURE = 0.8;
const CHAT_MAX_TOKENS = 600;
const CHAT_TEMPERATURE = 0.5;

// Flyttet til model-tuning.ts (delt med quiz-bankens batch-generering); re-eksportert herfra.
export { isReasoningModel, completionTuning } from './model-tuning';

/** Tak på antall LLM↔verktøy-runder, så en agent ikke kan løkke i det uendelige. */
const MAX_TOOL_ROUNDS = 6;

const SYSTEM_PROMPT = `Du er en innsiktsfull, varm og talevennlig norsk Resonans-assistent. Svaret ditt leses høyt.
Du har samme brede tilgang som Resonans-chatten OG er ekspert på bil og bilturer.

Bruk verktøyene AKTIVT og av eget initiativ når noe kan besvares eller gjøres med dem — ikke be
om lov for oppslag, og ikke gjett. Du kan blant annet:
- Bil og biltur: biltilstand (query_tesla_vehicle: batteri, rekkevidde, lading, posisjon),
  kjøreavstand og kjøretid mellom steder (driving_route — startpunkt er bilens posisjon når du
  ikke oppgir origin), og ladere nær bilen (nearby_chargers).
- Trening: programmer (programList → programDetail / manage_training_program), dagens økt
  (programToday), nylige økter (recentSessions), utøver-kontekst (athleteContext).
- Dag og sted (dayPlan), økonomi, familie, hjem, prosjekter, mat/oppskrifter/handleliste,
  sensorer og helse, tema og rutiner, og vær (weather_forecast).
- Fange og endre: opprette oppgaver/mål, registrere aktivitet, lagre notater og minner, og
  justere planer via de relevante verktøyene.
- Bilferie-quiz: kjør en leken quiz for hele bilen (trip_companions, quiz_score).
- Interaktive fortellinger: fortell et velg-selv-eventyr eller en madlib for hele bilen
  (trip_companions, story_start, story_scene/story_request/story_fill, story_state, story_end).

Quizmaster (når brukeren vil ha quiz/spill på bilturen):
- Quiz-start: kall trip_companions og quiz_score action="start" i samme runde. Start gir alltid
  en FERSK quiz med tom deltakerliste — spillere fra en tidligere quiz arves ALDRI. FORESLÅ
  laget fra trip_companions («Er det Erle 7, Nils 9 og Kjetil 42 som spiller?») og registrer
  det først når brukeren bekrefter — det gjelder også «samme lag som sist».
- Registrering: parse HELE ytringen til ETT register-kall. «Erle 7, Nils 9 og Kjetil 42»
  (komma eller «og» mellom navnene) er TRE spillere i samme players-array — aldri bare den
  første. Ta med interests fra trip_companions for kjente personer. Les hele laget med alder
  tilbake før første spørsmål: «Da spiller Erle 7, Nils 9 og Kjetil 42. Klar?»
- Tema + bank: avklar tema (eller foreslå ett som treffer interessene) og kall quiz_score
  action="prepare" med temaet. Banken er alderstilpasset per spiller (en 7-åring og en
  42-åring får ulikt nivå) og unngår alt som er stilt før. Du lager ALDRI spørsmål selv —
  hvert spørsmål trekkes fra banken.
- Spilletur: kall action="next" (verktøyet roterer turen og gir deg spørsmålet MED fasit) rett
  før du leser spørsmålet høyt. Når spilleren svarer: avgjør rett/galt mot fasiten fra next,
  kall action="record" (questionId + correct), og kall gjerne next for neste spiller i SAMME
  verktøyrunde — så hele svaret ditt kommer som én melding.
- Svar-form (VIKTIG): hvert quiz-svar er ÉN melding i korte, talevennlige setninger uten
  markdown, i FAST rekkefølge: først fasit-vurderingen, så poeng/stilling, så neste spørsmål.
  Eksempel: «Riktig, det er snø! Erle har 3 poeng og leder. Nils, din tur: hva heter
  hovedstaden i Frankrike?» Den FØRSTE talte setningen er alltid fasiten — aldri noe annet
  foran. Ikke skriv tekst i verktøyrundene underveis.
- Svarer record med alreadyGraded, er svaret allerede bokført: IKKE vurder på nytt — kvitter
  kort («Det har vi allerede tatt!») og les gjeldende spørsmål en gang til.
- Går banken tom (next sier fra), etterfyll med action="prepare" — den hopper over alt som er
  stilt. Bruk streak-hintet fra record til korte, varme tilrop («tre på rad, Erle er on fire!»)
  og les opp stillingen av og til.
- Det finnes en spill-skjerm («Spill») som viser stillingen live; den kan deles til et eget
  nettbrett i baksetet. Nevn den hvis det passer, men spillet funker fint på stemmen alene.
- Hold det gøy og inkluderende: ros forsøk. Avslutt med quiz_score action="end" og kår en
  vinner når de vil gi seg.

Forteller (når brukeren vil høre en historie / et eventyr på bilturen):
- Hent trip_companions FØRST for navn og ALDER på passasjerene, og kalibrer tonen mot den yngste.
  Velg variant med story_start: "branching" (velg-selv-eventyr) er standard for en lang biltur;
  "madlib" (tulle-fortelling der dere fyller inn ord) er kortere og fjollete — sett blanksTotal.
- Tone: sikt mot Roald Dahl-stemningen (Heksene, SVK) — magisk og oppfinnsom, med rar språkglede,
  barnehelter og passe grøssende skurker. Spennende og litt nifst, men alltid trygt og lekent,
  aldri ekte horror eller mareritt. Hold avsnittene KORTE og bil-vennlige (de leses høyt).
- Velg-selv-eventyr har to faser. story_start setter phase="setup": bygg verdenen med hyppige,
  åpne spørsmål — ett om gangen — og lås hvert svar inn i world via story_scene: univers/sjanger
  (Zelda, Stjerneskogen, Star Wars eller noe de finner på), hvem som er med (er passasjerene selv
  helter?), hvor dere er på vei og hvordan det er der, og hva dere skal gjøre der. Tilby gjerne
  forslag i choices, men fritt talesvar gjelder alltid. Når kjernekonteksten sitter, bytt til
  phase="adventure": lengre avsnitt og valg om hva man GJØR (utforske, kjempe, hjelpe, liste seg
  forbi). Veivalg er altså hyppige i starten, mer handlingsorienterte etter hvert.
- Allusjon, ikke gjengivelse: den ekte turen er INSPIRASJON, ikke manus. Forvandle konteksten —
  fotballcupen blir et mesterskap i Stjerneskogen, hytteturen et skjult tårn. Ingen bokstavelig
  presisjon om reiserute eller klokkeslett, bare gjenkjennelige glimt. world beskriver den
  fantastiske verdenen, ikke dagsplanen.
- INVARIANT (branching): når en spiller sier et valg, fortell neste avsnitt KONSEKVENT med valget
  via story_scene SAMTIDIG som du leser det høyt — det er én udelelig operasjon — FØR du flytter
  turen videre. Alltid nøyaktig to valg med stabile id-er «a» og «b».
- Madlib: bruk story_request for å be om neste ord (sett slot, f.eks. «et adjektiv») RETT FØR du
  spør i tale, story_fill for å bokføre ordet de ga. Avslør hele tulle-fortellingen med story_end
  FØRST når alle ord er samlet (blanksFilled === blanksTotal).
- Sammenheng: hold en intern fortellings-bibel (kanon: figurer/steder/regler; bue: hvor historien
  er på vei og hvilket beat dere er på; tone). Oppdater den via bible-feltet på story_start/
  story_scene, og les den med story_state ved START av hver fortelling-tur så kanon og buen holder
  over en halvtime. Ved gjenopptakelse etter et opphold (også neste dag): kall story_state og gi en
  kort «Sist i eventyret …»-gjenoppfriskning før du fortsetter.
- Pacing: ikke sikt mot rask slutt — vev inn nye tråder, steder og figurer, og bruk «vil dere høre
  mer?»-kroker. Avslutt (story_end) først når passasjerene selv vil runde av, eller når en bue
  naturlig lander. Tissepauser er gratis: bare slutt å snakke, tilstanden står.
- Det finnes en delt skjerm for baksetet (samme «del»-mønster som quizen) som viser world og siste
  avsnitt live; den fulle teksten avsløres først når fortellingen er avsluttet. Nevn den hvis det
  passer, men fortellingen funker fint på stemmen alene.

Notater og minner:
- «Lagre et notat / en refleksjon / skriv ned dette» → create_note med brukerens EGNE ord (lett
  vasket for talefeil), ikke et sammendrag. Under en pågående reise/ferie havner notatet i
  reisedagboka; ellers som dagsnotat. Det dukker også opp i dagbok-tråden i Resonans — bekreft
  kort HVOR det havnet (verktøysvaret sier det).
- create_memory er KUN for stabile fakta om brukeren (preferanser, varige forhold) — ikke for
  dagsnotater eller refleksjoner.
- «Hva har jeg notert / hva skrev vi i dagboka» → query_reflections (kind 'feriedagbok' for
  reisedagbok, 'notat' for dagsnotater).

Bil-ekspertise:
- «Hvor langt/lenge til X»: bruk driving_route (ekte kjøreavstand/-tid, uten live trafikk).
- Rekker bilen turen? Sammenlign driving_route-avstanden mot rekkevidden fra
  query_tesla_vehicle. Er det knapt (legg inn margin), si fra og foreslå lading —
  bruk nearby_chargers og nevn vær på reisemålet (weather_forecast) når det er relevant.

Arbeidsmåte:
- Vage spørsmål («hva bør jeg prioritere i morgen?») besvares ved å FØRST hente relevant
  kontekst og DERETTER svare konkret — ikke et generelt ikke-svar.
- Finn riktig id (programId, goalId, projectId …) med et liste-/query-verktøy før du endrer noe.
- Bekreft konkrete ENDRINGER med brukeren ved tvil — tale kan mishøres. Oppslag/lesing gjør du
  uten å spørre.
- Når et verktøy gir tomt resultat, si hva som mangler kort — ikke påstå at du «ikke har tilgang».

Stil:
- Korte svar (det leses høyt). Ren tekst, INGEN markdown, ingen punktlister med tegn.
- Bygg på det som er sagt tidligere i samtalen.
- Bruk KUN tall og fakta fra verktøyene, tidskonteksten eller samtalen; aldri dikt opp tempo,
  puls, distanser, avstander, saldoer eller datoer. Mangler data, si det kort framfor å gjette.
- Unngå ordet «ekko».`;

/** Brukeren bor i Norge — assistenten forankres til Oslo-tid. */
const ASSISTANT_TZ = 'Europe/Oslo';

/**
 * Talevennlig nå-kontekst (ukedag, dato, klokkeslett) i brukerens tidssone. Uten denne faller
 * modellen tilbake på treningsdataen sin og kan påstå feil årstall («i dag er det 2023»).
 */
export function buildTimeContext(now: Date): string {
	const pretty = new Intl.DateTimeFormat('nb-NO', {
		timeZone: ASSISTANT_TZ,
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	}).format(now);
	const iso = localIsoDay(ASSISTANT_TZ, now);
	const hm = localHm(ASSISTANT_TZ, now);
	return `Akkurat nå er det ${pretty}, klokka ${hm} (ISO ${iso}). Bruk dette når brukeren sier «i dag», «i morgen» eller «i går», eller spør om dato/tid — aldri gjett årstall.`;
}

export interface AssistantTurnInput {
	userId: string;
	/** Brukerens nye ytring (lagres av kalleren som en user-tur). */
	prompt: string;
	/** Valgfri program-peker — legger til kompakt program-kontekst. */
	programId?: string | null;
	/** Tidligere turer i tråden, kronologisk (allerede klippet til kontekst-vinduet). */
	history: ConversationTurn[];
	/** Antall eldre turer som ble utelatt fra `history` (for en kort norsk notis til modellen). */
	droppedCount?: number;
	/** Efemær situasjonskontekst (live-metrikk). Injiseres for DENNE turen, lagres ALDRI. */
	context?: string | null;
}

/** Kompakt program-kontekst når en programId er pekt på (best-effort). */
async function buildProgramContext(userId: string, programId: string): Promise<string | null> {
	try {
		const program = await getFullProgram(userId, programId);
		if (!program) return null;
		const all = program.weeks.flatMap((w) => w.sessions);
		const completed = all.filter((s) => s.completion).length;
		return [
			`Aktivt program i fokus: ${program.name}`,
			`Mål: ${program.goal}`,
			`Fullført: ${completed} av ${all.length} økter`,
			`programId: ${program.id}`
		].join('\n');
	} catch (error) {
		console.error('[assistant] kunne ikke bygge programkontekst:', error);
		return null;
	}
}

/**
 * Bygg LLM-meldingene for en assistent-tur (delt mellom strømmende og ikke-strømmende vei):
 * system-prompt → valgfri program-kontekst → trunkerings-notis → trådhistorikk → efemær
 * situasjonskontekst → brukerens nye ytring.
 */
async function buildAssistantMessages(
	input: AssistantTurnInput
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
	const { userId, prompt, programId, history, droppedCount = 0, context } = input;

	const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
		{ role: 'system', content: SYSTEM_PROMPT },
		{ role: 'system', content: buildTimeContext(new Date()) }
	];

	if (programId) {
		const programContext = await buildProgramContext(userId, programId);
		if (programContext) {
			messages.push({ role: 'system', content: programContext });
		}
	}

	if (droppedCount > 0) {
		messages.push({
			role: 'system',
			content: `Tidligere i samtalen: ${droppedCount} eldre ${droppedCount === 1 ? 'melding' : 'meldinger'} er utelatt for å spare plass.`
		});
	}

	for (const turn of history) {
		messages.push({ role: turn.role, content: turn.text });
	}

	const ephemeral = typeof context === 'string' ? context.trim() : '';
	if (ephemeral) {
		messages.push({
			role: 'system',
			content: `Situasjonskontekst akkurat nå (kan endre seg, ikke lagret): ${ephemeral}`
		});
	}

	messages.push({ role: 'user', content: prompt });
	return messages;
}

/**
 * Kjør én tur i en assistent-samtale med server-kjørt agent-løkke. Returnerer den endelige
 * teksten og hvilke verktøy som ble brukt (for transparens/feilsøking).
 */
export async function runAssistantTurn(
	input: AssistantTurnInput
): Promise<{ text: string; usedTools: string[] }> {
	const messages = await buildAssistantMessages(input);
	const usedTools: string[] = [];
	// Aktiv fortelling ⇒ sterk forteller-modell; aktiv quiz ⇒ rask spilletur-modell (også runde 0).
	const [storyTurn, quizTurn] = await Promise.all([
		hasActiveStory(input.userId),
		hasActiveQuiz(input.userId)
	]);

	try {
		for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
			// Siste runde: tving et tekstsvar ved å ikke tilby verktøy lenger.
			const offerTools = round < MAX_TOOL_ROUNDS;
			// Etter at et story_*-verktøy er brukt i turen (f.eks. «start en fortelling»), gå over til
			// forteller-modellen for resten — så selve narrasjonen leveres på den sterke tieren.
			const useStory = storyTurn || usedTools.some((n) => n.startsWith('story_'));
			// Quiz-turer på rask modell — men fortelling vinner hvis begge er aktive.
			const useQuiz = !useStory && (quizTurn || usedTools.some((n) => n.startsWith('quiz_')));
			const activeModel = useStory ? storyModel() : useQuiz ? quizModel() : model();
			const response = await openai.chat.completions.create({
				model: activeModel,
				messages,
				...completionTuning(
					activeModel,
					useStory ? STORY_MAX_TOKENS : CHAT_MAX_TOKENS,
					useStory ? STORY_TEMPERATURE : CHAT_TEMPERATURE
				),
				...(offerTools ? { tools: ASSISTANT_TOOL_DEFINITIONS, tool_choice: 'auto' as const } : {})
			});

			const choice = response.choices[0]?.message;
			const toolCalls = choice?.tool_calls ?? [];

			if (offerTools && toolCalls.length > 0) {
				messages.push({ role: 'assistant', content: choice?.content ?? null, tool_calls: toolCalls });
				for (const call of toolCalls) {
					if (call.type !== 'function') continue;
					usedTools.push(call.function.name);
					let args: Record<string, unknown> = {};
					try {
						args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
					} catch {
						args = {};
					}
					const result = await runAssistantTool(input.userId, call.function.name, args);
					messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
				}
				continue;
			}

			const text = choice?.content?.trim();
			if (text) {
				return { text, usedTools: Array.from(new Set(usedTools)) };
			}
			// Ingen verktøykall og tomt svar — be om et endelig svar én gang til via løkka.
		}
		throw new AssistantError('Agenten nådde rundetaket uten et endelig svar');
	} catch (error) {
		if (error instanceof AssistantError) throw error;
		throw new AssistantError('LLM-/verktøy-kall feilet', error);
	}
}

/** Akkumulator for verktøykall som strømmer inn fragmentvis (id/name/arguments i biter). */
interface StreamingToolCall {
	id: string;
	name: string;
	args: string;
}

/**
 * Strømmende variant av {@link runAssistantTurn}. Verktøyrundene løses som vanlig (agenten
 * eier løkka), og når modellen til slutt svarer med tekst i stedet for verktøykall, sendes
 * hvert token-fragment til `onDelta`. Returnerer den fulle teksten (for persistering) og
 * hvilke verktøy som ble brukt.
 */
export async function runAssistantTurnStreaming(
	input: AssistantTurnInput,
	onDelta: (chunk: string) => void
): Promise<{ text: string; usedTools: string[] }> {
	const messages = await buildAssistantMessages(input);
	const usedTools: string[] = [];
	let streamedText = '';
	// Aktiv fortelling ⇒ sterk forteller-modell; aktiv quiz ⇒ rask spilletur-modell (også runde 0).
	const [storyTurn, quizTurn] = await Promise.all([
		hasActiveStory(input.userId),
		hasActiveQuiz(input.userId)
	]);

	try {
		for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
			const offerTools = round < MAX_TOOL_ROUNDS;
			// Etter at et story_*-verktøy er brukt i turen, gå over til forteller-modellen for resten,
			// så selve narrasjonen som strømmes til klienten leveres på den sterke tieren.
			const useStory = storyTurn || usedTools.some((n) => n.startsWith('story_'));
			// Quiz-turer på rask modell — men fortelling vinner hvis begge er aktive.
			const useQuiz = !useStory && (quizTurn || usedTools.some((n) => n.startsWith('quiz_')));
			const activeModel = useStory ? storyModel() : useQuiz ? quizModel() : model();
			const stream = await openai.chat.completions.create({
				model: activeModel,
				messages,
				...completionTuning(
					activeModel,
					useStory ? STORY_MAX_TOKENS : CHAT_MAX_TOKENS,
					useStory ? STORY_TEMPERATURE : CHAT_TEMPERATURE
				),
				stream: true,
				...(offerTools ? { tools: ASSISTANT_TOOL_DEFINITIONS, tool_choice: 'auto' as const } : {})
			});

			let content = '';
			const toolAcc = new Map<number, StreamingToolCall>();
			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta;
				if (delta?.content) {
					content += delta.content;
					streamedText += delta.content;
					onDelta(delta.content);
				}
				for (const tc of delta?.tool_calls ?? []) {
					const cur = toolAcc.get(tc.index) ?? { id: '', name: '', args: '' };
					if (tc.id) cur.id = tc.id;
					if (tc.function?.name) cur.name += tc.function.name;
					if (tc.function?.arguments) cur.args += tc.function.arguments;
					toolAcc.set(tc.index, cur);
				}
			}

			const toolCalls = [...toolAcc.values()].filter((t) => t.name);
			if (offerTools && toolCalls.length > 0) {
				messages.push({
					role: 'assistant',
					content: content || null,
					tool_calls: toolCalls.map((t) => ({
						id: t.id,
						type: 'function' as const,
						function: { name: t.name, arguments: t.args }
					}))
				});
				for (const t of toolCalls) {
					usedTools.push(t.name);
					let args: Record<string, unknown> = {};
					try {
						args = t.args ? JSON.parse(t.args) : {};
					} catch {
						args = {};
					}
					const result = await runAssistantTool(input.userId, t.name, args);
					messages.push({ role: 'tool', tool_call_id: t.id, content: JSON.stringify(result) });
				}
				continue;
			}

			const text = streamedText.trim();
			if (text) {
				return { text, usedTools: Array.from(new Set(usedTools)) };
			}
			// Tomt svar uten verktøykall — prøv en runde til.
		}
		throw new AssistantError('Agenten nådde rundetaket uten et endelig svar');
	} catch (error) {
		if (error instanceof AssistantError) throw error;
		throw new AssistantError('LLM-/verktøy-kall feilet', error);
	}
}
