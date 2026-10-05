import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import OpenAI from 'openai';
import { createChatCompletionWithFallback, ModelRejectionMemory } from './chat-completion';

/**
 * Den EKTE OpenAI-SDK-en mot en lokal server som snakker OpenAIs SSE-format.
 *
 * `chat-completion.test.ts` beviser rekkefølgen med en falsk klient; denne
 * beviser at SDK-ens `stream()` faktisk oppfører seg slik den falske antar —
 * `content.delta`, verktøykall satt sammen av biter, `completion.model` fra
 * strømmen, og et 400-svar som en feil med `status`. Feiler denne etter en
 * SDK-oppgradering, er det kontrakten som har flyttet seg. Ingen nettverk ut.
 */

const base = { id: 'x', object: 'chat.completion.chunk', created: 0 };
const sse = (chunks: object[]) =>
	chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';

const seen: Array<Record<string, any>> = [];
let server: http.Server;
let client: OpenAI;

beforeAll(async () => {
	server = http.createServer((req, res) => {
		let body = '';
		req.on('data', (d) => (body += d));
		req.on('end', () => {
			const json = JSON.parse(body);
			seen.push(json);
			if (json.model === 'avvises') {
				res.writeHead(400, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ error: { message: 'Unsupported parameter: verbosity', type: 'invalid_request_error' } }));
				return;
			}
			const model = `${json.model}-2026`;
			res.writeHead(200, { 'content-type': 'text/event-stream' });
			if (json.messages[0].content === 'verktøy') {
				res.end(
					sse([
						{ ...base, model, choices: [{ index: 0, delta: { role: 'assistant', content: 'La meg sjekke' }, finish_reason: null }] },
						{ ...base, model, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'query_weight', arguments: '{"a":' } }] }, finish_reason: null }] },
						{ ...base, model, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] }, finish_reason: null }] },
						{ ...base, model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }
					])
				);
				return;
			}
			res.end(
				sse([
					{ ...base, model, choices: [{ index: 0, delta: { role: 'assistant', content: 'Ned ' }, finish_reason: null }] },
					{ ...base, model, choices: [{ index: 0, delta: { content: '0,4 kg.' }, finish_reason: null }] },
					{ ...base, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
				])
			);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
	const { port } = server.address() as AddressInfo;
	client = new OpenAI({ apiKey: 'test', baseURL: `http://127.0.0.1:${port}/v1`, maxRetries: 0 });
});

afterAll(() => {
	server.close();
});

const sizing = { temperature: 0.8, maxTokens: 1000 };

function hooks() {
	const tokens: string[] = [];
	const state = { resets: 0 };
	return { tokens, state, stream: { onDelta: (t: string) => tokens.push(t), onReset: () => void (state.resets += 1) } };
}

describe('createChatCompletionWithFallback mot ekte SDK', () => {
	it('strømmer ordene og returnerer svaret med modellen som faktisk svarte', async () => {
		const h = hooks();
		const result = await createChatCompletionWithFallback(
			client,
			{ model: 'gpt-5.4', messages: [{ role: 'user', content: 'hei' }], max_completion_tokens: 4000, reasoning_effort: 'low', verbosity: 'low' },
			sizing,
			{ stream: h.stream, memory: new ModelRejectionMemory() }
		);
		expect(h.tokens.join('')).toBe('Ned 0,4 kg.');
		expect(result.choices[0].message.content).toBe('Ned 0,4 kg.');
		expect(result.model).toBe('gpt-5.4-2026');
		expect(seen.at(-1)).toMatchObject({ stream: true, reasoning_effort: 'low', verbosity: 'low', max_completion_tokens: 4000 });
	});

	it('setter sammen verktøykallet og nullstiller praten foran det', async () => {
		const h = hooks();
		const result = await createChatCompletionWithFallback(
			client,
			{ model: 'gpt-5.4', messages: [{ role: 'user', content: 'verktøy' }] },
			sizing,
			{ stream: h.stream, memory: new ModelRejectionMemory() }
		);
		expect(h.state.resets).toBe(1);
		expect(result.choices[0].message.tool_calls?.[0]).toMatchObject({
			id: 'call_1',
			function: { name: 'query_weight', arguments: '{"a":1}' }
		});
	});

	it('et 400-svar uten parameternavn: samme modell uten de valgfrie, så reserven', async () => {
		const h = hooks();
		let fellBack = false;
		const result = await createChatCompletionWithFallback(
			client,
			{ model: 'avvises', messages: [{ role: 'user', content: 'hei' }], verbosity: 'low' },
			sizing,
			{ stream: h.stream, onFallback: () => void (fellBack = true), memory: new ModelRejectionMemory() }
		);
		expect(fellBack).toBe(true);
		expect(result.model).toBe('gpt-4o-2026');
		// Andre forsøk: samme modell, uten verbosity.
		expect(seen.at(-2)).toMatchObject({ model: 'avvises' });
		expect(seen.at(-2)).not.toHaveProperty('verbosity');
		expect(seen.at(-1)).toMatchObject({ model: 'gpt-4o', temperature: 0.8, max_tokens: 1000 });
		expect(seen.at(-1)).not.toHaveProperty('verbosity');
	});
});
