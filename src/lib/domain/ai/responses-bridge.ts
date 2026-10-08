/**
 * Broen mellom Chat Completions og Responses-API-et: en Chat Completions-
 * forespørsel inn, en Responses-forespørsel ut — og svaret tilbake som en
 * `ChatCompletion`. Se `docs/changelog/2026-10-08-responses-broen.md`.
 *
 * ## Hvorfor en bro, og ikke en omskriving
 *
 * Hovedchatten er skrevet mot Chat Completions: verktøyløkka, strømmingen,
 * reserven og målingene leser `ChatCompletion`. Responses er grunnen til å
 * bytte — der kan gpt-5.x tenke OG kalle verktøy, og tenkingen kan bæres
 * mellom verktøyrundene — men en omskriving av løkka for å finne ut om byttet
 * lønner seg, er å betale før man vet. Broen gjør at samme løkke kan kjøres
 * over begge, og at Stemmegaffel (`resonans-lab/stemmegaffel`) kan måle de to
 * mot hverandre med NØYAKTIG koden chatten skal bruke.
 *
 * ## Fire ting som ikke er en ren navneendring
 *
 * - **Verktøy er `strict: true` som standard i Responses.** Resonans' skjemaer
 *   er skrevet for Chat Completions (valgfrie felt, ingen
 *   `additionalProperties: false`), og strict avviser dem. Broen setter
 *   `strict: false` med mindre verktøyet selv sier noe annet.
 * - **Tenkingen bæres som elementer, ikke som tekst.** Et assistentsvar fra
 *   broen har Responses-elementene sine under `RESPONSES_OUTPUT_KEY`. Sendes
 *   meldingen tilbake i neste runde, legges elementene inn ordrett — også
 *   `reasoning`-elementene med `encrypted_content` — i stedet for å bygges
 *   på nytt av `content` og `tool_calls`. Det er hele forskjellen på «tenker
 *   før første verktøykall» og «tenker gjennom hele løkka».
 * - **`store: false`, alltid.** Samtalene har helse- og økonomidata, og de
 *   skal ikke ligge hos OpenAI for å kunne fortsettes. Derfor ingen
 *   `previous_response_id`; tenkingen bæres kryptert i forespørselen.
 * - **Ukjente felt avvises.** En oversettelse som stille dropper et felt den
 *   ikke kjenner, er en utplukking som glemmer et felt — og den sier ikke fra.
 *   Kjenner broen ikke feltet, kastes en feil som navngir det.
 *
 * Bumpes `RESPONSES_BRIDGE_VERSION`, måler Stemmegaffel på nytt.
 */

import type {
	ChatCompletion,
	ChatCompletionContentPart,
	ChatCompletionCreateParams,
	ChatCompletionMessage,
	ChatCompletionMessageParam,
	ChatCompletionMessageToolCall
} from 'openai/resources/chat/completions';
import type {
	Response,
	ResponseCreateParamsNonStreaming,
	ResponseInputItem,
	ResponseOutputItem,
	ResponseStreamEvent
} from 'openai/resources/responses/responses';

export const RESPONSES_BRIDGE_VERSION = 1;

/** Nøkkelen et assistentsvar bærer Responses-elementene sine under. */
export const RESPONSES_OUTPUT_KEY = 'responses_output';

/** Et assistentsvar fra broen: Chat-formen, med elementene som skal tilbake i neste runde. */
export type BridgedAssistantMessage = ChatCompletionMessage & { [RESPONSES_OUTPUT_KEY]?: ResponseOutputItem[] };

/** Feltene broen oversetter. Alt annet avvises. */
const HANDLED = new Set([
	'model',
	'messages',
	'tools',
	'tool_choice',
	'parallel_tool_calls',
	'max_tokens',
	'max_completion_tokens',
	'temperature',
	'top_p',
	'reasoning_effort',
	'verbosity',
	'response_format',
	// Strømmingen avgjøres av kalleren (`stream: true` på Responses-kallet).
	'stream',
	'stream_options'
]);

export class ResponsesBridgeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ResponsesBridgeError';
	}
}

function textOf(content: ChatCompletionMessageParam['content']): string {
	if (typeof content === 'string') return content;
	if (!content) return '';
	return content.map((p) => ('text' in p ? p.text : '')).join('');
}

function userContent(content: string | ChatCompletionContentPart[]) {
	if (typeof content === 'string') return content;
	return content.map((part) => {
		switch (part.type) {
			case 'text':
				return { type: 'input_text' as const, text: part.text };
			case 'image_url':
				return { type: 'input_image' as const, image_url: part.image_url.url, detail: part.image_url.detail ?? 'auto' };
			case 'file':
				return {
					type: 'input_file' as const,
					...(part.file.file_data ? { file_data: part.file.file_data } : {}),
					...(part.file.file_id ? { file_id: part.file.file_id } : {}),
					...(part.file.filename ? { filename: part.file.filename } : {})
				};
			default:
				throw new ResponsesBridgeError(`Innholdstypen «${part.type}» oversettes ikke.`);
		}
	});
}

/**
 * Meldingene → `instructions` + `input`. Systemmeldingene FØRST i lista blir
 * `instructions`, slik de leses i Chat Completions; en system- eller
 * developer-melding lenger ned blir en developer-melding der den står.
 */
export function toResponsesInput(messages: ChatCompletionMessageParam[]): { instructions: string | null; input: ResponseInputItem[] } {
	const leading: string[] = [];
	let i = 0;
	for (; i < messages.length && messages[i].role === 'system'; i++) leading.push(textOf(messages[i].content));

	const input: ResponseInputItem[] = [];
	for (const m of messages.slice(i)) {
		switch (m.role) {
			case 'system':
			case 'developer':
				input.push({ role: 'developer', content: textOf(m.content) });
				break;
			case 'user':
				input.push({ role: 'user', content: userContent(m.content) } as ResponseInputItem);
				break;
			case 'assistant': {
				const carried = (m as BridgedAssistantMessage)[RESPONSES_OUTPUT_KEY];
				if (Array.isArray(carried)) {
					// Ordrett: tenkingen, teksten og kallene, slik modellen skrev dem.
					input.push(...(carried as ResponseInputItem[]));
					break;
				}
				const text = textOf(m.content);
				if (text) input.push({ role: 'assistant', content: text });
				for (const call of m.tool_calls ?? []) {
					if (call.type !== 'function') throw new ResponsesBridgeError(`Verktøykallet «${call.type}» oversettes ikke.`);
					input.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments });
				}
				break;
			}
			case 'tool':
				input.push({ type: 'function_call_output', call_id: m.tool_call_id, output: textOf(m.content) });
				break;
			default:
				throw new ResponsesBridgeError(`Rollen «${(m as { role: string }).role}» oversettes ikke.`);
		}
	}
	return { instructions: leading.length ? leading.join('\n\n') : null, input };
}

export interface ToResponsesOptions {
	/**
	 * Be om tenkingen kryptert tilbake, så den kan bæres til neste runde.
	 * Standard: når `reasoning_effort` er satt og ikke er `none`.
	 */
	encryptedReasoning?: boolean;
}

/** En Chat Completions-forespørsel som Responses-forespørsel. Kaster på felt broen ikke kjenner. */
export function toResponsesRequest(
	body: ChatCompletionCreateParams & Record<string, unknown>,
	options: ToResponsesOptions = {}
): ResponseCreateParamsNonStreaming {
	const unknown = Object.keys(body).filter((k) => !HANDLED.has(k) && body[k] !== undefined);
	if (unknown.length) throw new ResponsesBridgeError(`Feltene ${unknown.join(', ')} oversettes ikke til Responses.`);
	if (body.stream_options && !body.stream) throw new ResponsesBridgeError('stream_options uten stream.');

	const { instructions, input } = toResponsesInput(body.messages);
	const out: ResponseCreateParamsNonStreaming = { model: body.model, input, store: false };
	if (instructions !== null) out.instructions = instructions;

	if (body.tools?.length) {
		out.tools = body.tools.map((t) => {
			if (t.type !== 'function') throw new ResponsesBridgeError(`Verktøytypen «${t.type}» oversettes ikke.`);
			return {
				type: 'function' as const,
				name: t.function.name,
				description: t.function.description ?? null,
				parameters: (t.function.parameters ?? { type: 'object', properties: {} }) as Record<string, unknown>,
				// Responses er strict som standard; Resonans' skjemaer er ikke skrevet for det.
				strict: t.function.strict ?? false
			};
		});
	}
	if (body.tool_choice !== undefined) {
		const c = body.tool_choice;
		if (typeof c === 'string') out.tool_choice = c;
		else if (c.type === 'function') out.tool_choice = { type: 'function', name: c.function.name };
		else throw new ResponsesBridgeError(`tool_choice «${c.type}» oversettes ikke.`);
	}
	if (body.parallel_tool_calls !== undefined) out.parallel_tool_calls = body.parallel_tool_calls;

	const maxTokens = body.max_completion_tokens ?? body.max_tokens;
	if (maxTokens !== undefined && maxTokens !== null) out.max_output_tokens = maxTokens;
	if (body.temperature !== undefined) out.temperature = body.temperature;
	if (body.top_p !== undefined) out.top_p = body.top_p;

	const effort = body.reasoning_effort as string | null | undefined;
	if (effort) out.reasoning = { effort: effort as never };
	const encrypted = options.encryptedReasoning ?? (!!effort && effort !== 'none');
	if (encrypted) out.include = ['reasoning.encrypted_content'];

	const text: NonNullable<ResponseCreateParamsNonStreaming['text']> = {};
	if (body.verbosity) text.verbosity = body.verbosity;
	const rf = body.response_format;
	if (rf) {
		if (rf.type === 'json_object' || rf.type === 'text') text.format = { type: rf.type };
		else if (rf.type === 'json_schema')
			text.format = {
				type: 'json_schema',
				name: rf.json_schema.name,
				schema: (rf.json_schema.schema ?? {}) as Record<string, unknown>,
				...(rf.json_schema.strict !== undefined ? { strict: rf.json_schema.strict } : {}),
				...(rf.json_schema.description ? { description: rf.json_schema.description } : {})
			};
		else throw new ResponsesBridgeError(`response_format «${(rf as { type: string }).type}» oversettes ikke.`);
	}
	if (Object.keys(text).length) out.text = text;
	return out;
}

function finishReason(response: Response, hasToolCalls: boolean): ChatCompletion.Choice['finish_reason'] {
	if (hasToolCalls) return 'tool_calls';
	if (response.status === 'incomplete') {
		const reason = response.incomplete_details?.reason;
		return reason === 'content_filter' ? 'content_filter' : 'length';
	}
	return 'stop';
}

/** Et Responses-svar som `ChatCompletion`, med elementene båret på meldingen. Kaster på et feilet svar. */
export function fromResponsesResponse(response: Response): ChatCompletion {
	if (response.status === 'failed' || response.error) {
		throw new ResponsesBridgeError(
			`Responses feilet: ${response.error?.code ?? 'ukjent'}: ${response.error?.message ?? 'ingen melding'}`
		);
	}
	let content = '';
	let refusal = '';
	const toolCalls: ChatCompletionMessageToolCall[] = [];
	for (const item of response.output) {
		if (item.type === 'message') {
			for (const part of item.content) {
				if (part.type === 'output_text') content += part.text;
				else if (part.type === 'refusal') refusal += part.refusal;
			}
		} else if (item.type === 'function_call') {
			toolCalls.push({ id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } });
		}
	}
	const message: BridgedAssistantMessage = {
		role: 'assistant',
		content: content || null,
		refusal: refusal || null,
		...(toolCalls.length ? { tool_calls: toolCalls } : {}),
		[RESPONSES_OUTPUT_KEY]: response.output
	};
	const u = response.usage;
	return {
		id: response.id,
		object: 'chat.completion',
		created: Math.round(response.created_at),
		model: response.model,
		choices: [{ index: 0, message, finish_reason: finishReason(response, toolCalls.length > 0), logprobs: null }],
		...(u
			? {
					usage: {
						prompt_tokens: u.input_tokens,
						completion_tokens: u.output_tokens,
						total_tokens: u.total_tokens,
						prompt_tokens_details: { cached_tokens: u.input_tokens_details?.cached_tokens ?? 0 },
						completion_tokens_details: { reasoning_tokens: u.output_tokens_details?.reasoning_tokens ?? 0 }
					}
				}
			: {})
	};
}

/** Hva en strømhendelse betyr for den som lytter. */
export type ResponsesStreamSignal =
	| { kind: 'text'; delta: string }
	| { kind: 'tool_call'; name: string }
	| { kind: 'done' }
	| null;

/**
 * Samler en Responses-strøm. `push` sier hva hendelsen betydde (tekst å vise,
 * et verktøykall som begynner), og `result` gir hele svaret som
 * `ChatCompletion` når strømmen er ferdig. Svaret bygges av den avsluttende
 * `response`-en, ikke av deltaene: den er fasit, deltaene er visning.
 */
export class ResponsesStreamCollector {
	#final: Response | null = null;

	push(event: ResponseStreamEvent): ResponsesStreamSignal {
		switch (event.type) {
			case 'response.output_text.delta':
				return event.delta ? { kind: 'text', delta: event.delta } : null;
			case 'response.output_item.added':
				return event.item.type === 'function_call' ? { kind: 'tool_call', name: event.item.name } : null;
			case 'response.completed':
			case 'response.incomplete':
				this.#final = event.response;
				return { kind: 'done' };
			case 'response.failed':
				this.#final = event.response;
				fromResponsesResponse(event.response);
				return { kind: 'done' };
			case 'error':
				throw new ResponsesBridgeError(`Responses-strømmen feilet: ${event.code ?? 'ukjent'}: ${event.message}`);
			default:
				return null;
		}
	}

	result(): ChatCompletion {
		if (!this.#final) throw new ResponsesBridgeError('Strømmen sluttet uten et ferdig svar.');
		return fromResponsesResponse(this.#final);
	}
}
