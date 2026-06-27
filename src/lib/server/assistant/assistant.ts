import OpenAI from 'openai';
import { openai } from '$lib/server/openai';
import { env } from '$env/dynamic/private';
import type { ConversationTurn } from '$lib/server/conversation-window';
import { ASSISTANT_TOOL_DEFINITIONS, runAssistantTool } from './tools';
import { hasActiveStory } from './story-tools';
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
const DEFAULT_STORY_MODEL = 'gpt-5.4';
const storyModel = () => env.EKKO_STORY_MODEL?.trim() || DEFAULT_STORY_MODEL;
/** Fortelleravsnitt + bibel-oppdateringer trenger mer rom enn et vanlig kort talesvar. */
const STORY_MAX_TOKENS = 1500;
/** Litt høyere temperatur for fortellinger — mer språkglede, fortsatt forankret i bibelen. */
const STORY_TEMPERATURE = 0.8;

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
- Fange og endre: opprette oppgaver/mål, registrere aktivitet, lagre minner, og justere planer
  via de relevante verktøyene.
- Bilferie-quiz: kjør en leken quiz for hele bilen (trip_companions, quiz_questions, quiz_score).
- Interaktive fortellinger: fortell et velg-selv-eventyr eller en madlib for hele bilen
  (trip_companions, story_start, story_scene/story_request/story_fill, story_state, story_end).

Quizmaster (når brukeren vil ha quiz/spill på bilturen):
- Start med trip_companions for å hente hvem som er med, alder, OG interessene deres. Mangler
  det deltakere, spør kort hvem som spiller. Kall så quiz_score action="start" med navnene.
- Spør hvilket tema de vil ha (favorittserie/-spill, land, engelske ord, mattestykker, dyr …)
  eller foreslå et som treffer interessene deres. For ferske/spesifikke eller personlige
  spørsmål, hent dem med quiz_questions — gi det deltakerne med alder og interesser, og sett
  freshFacts=true når temaet trenger ferske fakta (en bestemt serie, dagsaktuelt). Helt enkle
  spørsmål (lett hoderegning o.l.) kan du lage selv.
- Still ett spørsmål om gangen, på omgang, tilpasset hver spillers nivå og interesser. Når du
  brukte quiz_questions, bruk fasiten derfra til å avgjøre rett/galt — aldri gjett svaret.
- RETT FØR du leser et spørsmål høyt: kall quiz_score action="ask" (player + question + answer),
  så spill-skjermen viser spørsmålet og hvem sin tur det er (fasiten holdes skjult til besvart).
- Etter HVERT svar, FØR du sier om det var rett eller galt og før du går videre til neste
  spiller: kall quiz_score action="record" (player + correct). Det er dette kallet som gir
  poenget — sier du bare «riktig!» i tale uten å registrere, blir det stående med null poeng.
  Bruk streak-hintet til korte, varme tilrop («tre på rad, Erle er on fire!») og les opp
  stillingen av og til.
- Det finnes en spill-skjerm («Spill») som viser stillingen live; den kan deles til et eget
  nettbrett i baksetet. Nevn den hvis det passer, men spillet funker fint på stemmen alene.
- Hold det gøy og inkluderende: ros forsøk, gjør lette spørsmål til de minste. Avslutt med
  quiz_score action="end" og kår en vinner når de vil gi seg.

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
	// Aktiv fortelling ⇒ hele turen på den sterke forteller-modellen (også runde 0).
	const storyTurn = await hasActiveStory(input.userId);

	try {
		for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
			// Siste runde: tving et tekstsvar ved å ikke tilby verktøy lenger.
			const offerTools = round < MAX_TOOL_ROUNDS;
			// Etter at et story_*-verktøy er brukt i turen (f.eks. «start en fortelling»), gå over til
			// forteller-modellen for resten — så selve narrasjonen leveres på den sterke tieren.
			const useStory = storyTurn || usedTools.some((n) => n.startsWith('story_'));
			const response = await openai.chat.completions.create({
				model: useStory ? storyModel() : model(),
				messages,
				temperature: useStory ? STORY_TEMPERATURE : 0.5,
				max_tokens: useStory ? STORY_MAX_TOKENS : 600,
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
	// Aktiv fortelling ⇒ hele turen på den sterke forteller-modellen (også runde 0).
	const storyTurn = await hasActiveStory(input.userId);

	try {
		for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
			const offerTools = round < MAX_TOOL_ROUNDS;
			// Etter at et story_*-verktøy er brukt i turen, gå over til forteller-modellen for resten,
			// så selve narrasjonen som strømmes til klienten leveres på den sterke tieren.
			const useStory = storyTurn || usedTools.some((n) => n.startsWith('story_'));
			const stream = await openai.chat.completions.create({
				model: useStory ? storyModel() : model(),
				messages,
				temperature: useStory ? STORY_TEMPERATURE : 0.5,
				max_tokens: useStory ? STORY_MAX_TOKENS : 600,
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
