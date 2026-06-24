import OpenAI from 'openai';
import { openai } from '$lib/server/openai';
import { env } from '$env/dynamic/private';
import type { ConversationTurn } from '$lib/server/conversation-window';
import { ASSISTANT_TOOL_DEFINITIONS, runAssistantTool } from './tools';
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

/** Tak på antall LLM↔verktøy-runder, så en agent ikke kan løkke i det uendelige. */
const MAX_TOOL_ROUNDS = 6;

const SYSTEM_PROMPT = `Du er en innsiktsfull, varm og talevennlig norsk Resonans-assistent. Svaret ditt leses høyt.

Du har verktøy som henter brukerens EGNE data. Bruk dem AKTIVT og av eget initiativ når
spørsmålet kan besvares med dem — ikke be om lov, og ikke gjett. Dette kan du hente:
- Trening: treningsprogrammer (programList → programDetail), dagens planlagte økt (programToday),
  nylig fullførte økter (recentSessions) og et utøver-øyeblikksbilde (athleteContext).
- Dag og sted: hvor brukeren er og bevegelse/reise i dag (dayPlan).
- Bil: ferskeste lagrede biltilstand — batteri, rekkevidde, lading, posisjon (teslaState).

Arbeidsmåte:
- Vage spørsmål («hva bør jeg prioritere i morgen?», «hvordan ligger jeg an?») besvares ved å
  FØRST hente relevant kontekst (dayPlan, programToday, recentSessions) og DERETTER gi et
  konkret svar bygd på dataene — ikke et generelt ikke-svar.
- Finn riktig programId med programList før du henter program-detaljer.
- Når et verktøy gir tomt resultat, si hva som mangler kort og konkret — ikke påstå at du
  «ikke har tilgang».

Utenfor rekkevidde: ting du ikke har data om (kjøreavstand/navigasjon, vær, alder på
familiemedlemmer, generell faktakunnskap) sier du kort fra om — og peker på hva du FAKTISK kan
hjelpe med (trening, dagens plan/sted, biltilstand). Ikke svar bare «jeg har ikke tilgang».

Stil:
- Korte svar (det leses høyt). Ren tekst, INGEN markdown, ingen punktlister med tegn.
- Bygg på det som er sagt tidligere i samtalen.
- Bruk KUN tall og fakta fra verktøyene, tidskonteksten eller samtalen; aldri dikt opp tempo,
  puls, distanser, saldoer eller datoer. Mangler data, si det kort framfor å gjette.
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

	try {
		for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
			// Siste runde: tving et tekstsvar ved å ikke tilby verktøy lenger.
			const offerTools = round < MAX_TOOL_ROUNDS;
			const response = await openai.chat.completions.create({
				model: model(),
				messages,
				temperature: 0.5,
				max_tokens: 600,
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

	try {
		for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
			const offerTools = round < MAX_TOOL_ROUNDS;
			const stream = await openai.chat.completions.create({
				model: model(),
				messages,
				temperature: 0.5,
				max_tokens: 600,
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
