import OpenAI from 'openai';
import { openai } from '$lib/server/openai';
import { env } from '$env/dynamic/private';
import type { ConversationTurn } from '$lib/server/conversation-window';
import { ASSISTANT_TOOL_DEFINITIONS, runAssistantTool } from './tools';
import { getFullProgram } from '$lib/server/programs/repository';

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

Du har verktøy som henter brukerens egne data (treningsprogram, dagens økt, nylige økter,
utøver-kontekst, dagskontekst, biltilstand). Bruk dem aktivt når brukeren spør om noe som
krever faktiske tall — ikke gjett.

Stil:
- Korte svar (det leses høyt). Ren tekst, INGEN markdown, ingen punktlister med tegn.
- Bygg på det som er sagt tidligere i samtalen.
- Bruk KUN tall og fakta fra verktøyene eller samtalen; aldri dikt opp tempo, puls, distanser
  eller saldoer. Mangler data, si det kort framfor å gjette.
- Unngå ordet «ekko».`;

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
 * Kjør én tur i en assistent-samtale med server-kjørt agent-løkke. Returnerer den endelige
 * teksten og hvilke verktøy som ble brukt (for transparens/feilsøking).
 */
export async function runAssistantTurn(
	input: AssistantTurnInput
): Promise<{ text: string; usedTools: string[] }> {
	const { userId, prompt, programId, history, droppedCount = 0, context } = input;

	const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
		{ role: 'system', content: SYSTEM_PROMPT }
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
					const result = await runAssistantTool(userId, call.function.name, args);
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
