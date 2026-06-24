import Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { env } from '$env/dynamic/private';

/**
 * Oversetter mellom det kanoniske OpenAI-meldingsformatet (som agent-løkka og pending-tabellen
 * bruker) og Anthropic Messages-API-et, og strømmer fra Claude. Slik kan vi rute resonnement til
 * Claude uten å endre persisteringen eller resten av løkka.
 *
 * Oversettelsen er ren (testbar). Det som er verdt å passe på: Anthropic vil ha system som eget
 * felt, tool-kall som `tool_use`-blokker i en assistant-melding, og tool-svar som `tool_result`-
 * blokker SAMLET i én påfølgende user-melding (OpenAI har dem som separate `tool`-meldinger).
 */

type OpenAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type OpenAITool = OpenAI.Chat.Completions.ChatCompletionFunctionTool;

/** Streaming-resultat normalisert til samme form som OpenAI-veien returnerer. */
export interface StreamResult {
	content: string;
	toolCalls: Array<{ id: string; name: string; args: string }>;
}

function asText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : ''))
			.join('');
	}
	return '';
}

/** OpenAI-meldinger + verktøy → Anthropic-request (system, messages, tools). Ren. */
export function toAnthropicRequest(
	messages: OpenAIMessage[],
	tools: OpenAITool[]
): { system: string; messages: Anthropic.MessageParam[]; tools: Anthropic.Tool[] } {
	const systemParts: string[] = [];
	const out: Anthropic.MessageParam[] = [];

	for (const m of messages) {
		if (m.role === 'system') {
			const text = asText(m.content);
			if (text) systemParts.push(text);
			continue;
		}

		if (m.role === 'user') {
			out.push({ role: 'user', content: asText(m.content) });
			continue;
		}

		if (m.role === 'assistant') {
			const blocks: Anthropic.ContentBlockParam[] = [];
			const text = asText(m.content);
			if (text) blocks.push({ type: 'text', text });
			for (const tc of m.tool_calls ?? []) {
				if (tc.type !== 'function') continue;
				let input: unknown = {};
				try {
					input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
				} catch {
					input = {};
				}
				blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
			}
			out.push({ role: 'assistant', content: blocks.length > 0 ? blocks : text });
			continue;
		}

		if (m.role === 'tool') {
			const block: Anthropic.ToolResultBlockParam = {
				type: 'tool_result',
				tool_use_id: m.tool_call_id,
				content: asText(m.content)
			};
			// Slå sammen påfølgende tool-svar inn i én user-melding rett etter assistant-meldingen.
			const last = out[out.length - 1];
			if (last && last.role === 'user' && Array.isArray(last.content)) {
				last.content.push(block);
			} else {
				out.push({ role: 'user', content: [block] });
			}
		}
	}

	const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
		name: t.function.name,
		description: t.function.description ?? '',
		input_schema: (t.function.parameters ?? { type: 'object', properties: {} }) as Anthropic.Tool.InputSchema
	}));

	return { system: systemParts.join('\n\n'), messages: out, tools: anthropicTools };
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
	if (!env.ANTHROPIC_API_KEY?.trim()) {
		throw new Error('ANTHROPIC_API_KEY er ikke satt — kan ikke bruke Claude-modell');
	}
	client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
	return client;
}

/**
 * Strøm fra Claude og normaliser til {content, toolCalls} (samme form som OpenAI-veien).
 * `onDelta` får tekstfragmenter. Tool-bruk akkumuleres fra `input_json_delta`-eventene.
 */
export async function streamAnthropic(
	modelId: string,
	messages: OpenAIMessage[],
	tools: OpenAITool[],
	offerTools: boolean,
	onDelta: (chunk: string) => void
): Promise<StreamResult> {
	const req = toAnthropicRequest(messages, offerTools ? tools : []);
	const stream = await getClient().messages.create({
		model: modelId,
		max_tokens: 600,
		temperature: 0.5,
		system: req.system,
		messages: req.messages,
		...(offerTools ? { tools: req.tools, tool_choice: { type: 'auto' as const } } : {}),
		stream: true
	});

	let content = '';
	const toolAcc = new Map<number, { id: string; name: string; args: string }>();

	for await (const event of stream) {
		if (event.type === 'content_block_start') {
			const cb = event.content_block;
			if (cb.type === 'tool_use') {
				toolAcc.set(event.index, { id: cb.id, name: cb.name, args: '' });
			}
		} else if (event.type === 'content_block_delta') {
			const d = event.delta;
			if (d.type === 'text_delta') {
				content += d.text;
				onDelta(d.text);
			} else if (d.type === 'input_json_delta') {
				const cur = toolAcc.get(event.index);
				if (cur) cur.args += d.partial_json;
			}
		}
	}

	return { content, toolCalls: [...toolAcc.values()].filter((t) => t.name) };
}
