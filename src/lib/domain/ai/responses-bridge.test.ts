import { describe, expect, it } from 'vitest';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { Response, ResponseStreamEvent } from 'openai/resources/responses/responses';
import {
	fromResponsesResponse,
	RESPONSES_OUTPUT_KEY,
	ResponsesStreamCollector,
	toResponsesInput,
	toResponsesRequest,
	type BridgedAssistantMessage
} from './responses-bridge';
import { completionSizing } from './chat-model';
import { CHAT_TOOLS } from '$lib/server/chat/tools';

const tool = {
	type: 'function' as const,
	function: { name: 'query_training', description: 'Trening', parameters: { type: 'object', properties: { queryType: { type: 'string' } } } }
};

function response(over: Partial<Response>): Response {
	return {
		id: 'resp_1',
		object: 'response',
		created_at: 1791489600,
		model: 'gpt-5.4-2026-03-05',
		status: 'completed',
		error: null,
		incomplete_details: null,
		output: [],
		usage: {
			input_tokens: 1200,
			input_tokens_details: { cached_tokens: 1024 },
			output_tokens: 80,
			output_tokens_details: { reasoning_tokens: 64 },
			total_tokens: 1280
		},
		...over
	} as Response;
}

const reasoningItem = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'gAAAA-kryptert' };
const callItem = { type: 'function_call', id: 'fc_1', call_id: 'call_abc', name: 'query_training', arguments: '{"queryType":"load"}', status: 'completed' };
const messageItem = {
	type: 'message',
	id: 'msg_1',
	role: 'assistant',
	status: 'completed',
	content: [{ type: 'output_text', text: 'Du er litt sliten.', annotations: [] }]
};

describe('toResponsesInput', () => {
	it('systemmeldingene først blir instructions; en senere blir developer der den står', () => {
		const { instructions, input } = toResponsesInput([
			{ role: 'system', content: 'A' },
			{ role: 'system', content: 'B' },
			{ role: 'user', content: 'hei' },
			{ role: 'system', content: 'C' }
		]);
		expect(instructions).toBe('A\n\nB');
		expect(input).toEqual([{ role: 'user', content: 'hei' }, { role: 'developer', content: 'C' }]);
	});

	it('oversetter bilder og filer i en brukermelding', () => {
		const { input } = toResponsesInput([
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'les' },
					{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA', detail: 'high' } },
					{ type: 'file', file: { filename: 'a.pdf', file_data: 'data:application/pdf;base64,AA' } }
				]
			}
		]);
		expect(input[0]).toEqual({
			role: 'user',
			content: [
				{ type: 'input_text', text: 'les' },
				{ type: 'input_image', image_url: 'data:image/png;base64,AA', detail: 'high' },
				{ type: 'input_file', file_data: 'data:application/pdf;base64,AA', filename: 'a.pdf' }
			]
		});
	});

	it('et verktøykall og svaret på det blir function_call og function_call_output med samme call_id', () => {
		const { input } = toResponsesInput([
			{ role: 'user', content: 'formen?' },
			{ role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'query_training', arguments: '{}' } }] },
			{ role: 'tool', tool_call_id: 'call_1', content: '{"tsb":-5}' }
		]);
		expect(input.slice(1)).toEqual([
			{ type: 'function_call', call_id: 'call_1', name: 'query_training', arguments: '{}' },
			{ type: 'function_call_output', call_id: 'call_1', output: '{"tsb":-5}' }
		]);
	});

	it('et svar fra broen sendes tilbake ordrett — tenkingen med', () => {
		const forrige = fromResponsesResponse(response({ output: [reasoningItem, callItem] as never }));
		const { input } = toResponsesInput([
			{ role: 'user', content: 'formen?' },
			forrige.choices[0].message as ChatCompletionMessageParam,
			{ role: 'tool', tool_call_id: 'call_abc', content: '{}' }
		]);
		expect(input[1]).toEqual(reasoningItem);
		expect(input[2]).toEqual(callItem);
		expect(input[3]).toMatchObject({ type: 'function_call_output', call_id: 'call_abc' });
	});
});

describe('toResponsesRequest', () => {
	it('verktøy blir flate og IKKE strict — Responses er strict som standard', () => {
		const r = toResponsesRequest({ model: 'm', messages: [{ role: 'user', content: 'x' }], tools: [tool], tool_choice: 'auto' });
		expect(r.tools).toEqual([{ type: 'function', name: 'query_training', description: 'Trening', parameters: tool.function.parameters, strict: false }]);
		expect(r.tool_choice).toBe('auto');
	});

	it('et verktøy som selv sier strict, får beholde det', () => {
		const strict = { ...tool, function: { ...tool.function, strict: true } };
		const r = toResponsesRequest({ model: 'm', messages: [{ role: 'user', content: 'x' }], tools: [strict] });
		expect((r.tools![0] as { strict: boolean }).strict).toBe(true);
	});

	it('et tvunget verktøy får Responses-formen', () => {
		const r = toResponsesRequest({
			model: 'm',
			messages: [{ role: 'user', content: 'x' }],
			tools: [tool],
			tool_choice: { type: 'function', function: { name: 'query_training' } }
		});
		expect(r.tool_choice).toEqual({ type: 'function', name: 'query_training' });
	});

	it('token-taket, innsatsen og ordrikheten flytter, og tenkingen bes om kryptert', () => {
		const r = toResponsesRequest({
			model: 'm',
			messages: [{ role: 'user', content: 'x' }],
			max_completion_tokens: 2000,
			reasoning_effort: 'low',
			verbosity: 'low',
			response_format: { type: 'json_object' }
		});
		expect(r).toMatchObject({
			max_output_tokens: 2000,
			reasoning: { effort: 'low' },
			include: ['reasoning.encrypted_content'],
			text: { verbosity: 'low', format: { type: 'json_object' } },
			store: false
		});
	});

	it('uten tenking bes det ikke om kryptert tenking', () => {
		const r = toResponsesRequest({ model: 'm', messages: [{ role: 'user', content: 'x' }], reasoning_effort: 'none' as never, max_tokens: 100 });
		expect(r.include).toBeUndefined();
		expect(r.max_output_tokens).toBe(100);
	});

	it('avviser felt den ikke kjenner, og navngir dem', () => {
		expect(() => toResponsesRequest({ model: 'm', messages: [], seed: 1, n: 2 } as never)).toThrow(/seed, n/);
	});

	it('oversetter hele hovedchattens første runde: 68 verktøy og completionSizing', () => {
		for (const model of ['gpt-5.4', 'gpt-4o', 'gpt-6-luna']) {
			const body = {
				model,
				messages: [{ role: 'system' as const, content: 'S' }, { role: 'user' as const, content: 'formen?' }],
				tools: CHAT_TOOLS,
				tool_choice: 'auto' as const,
				...completionSizing(model, { temperature: 0.8, maxTokens: 1000, reasoningEffort: 'low', verbosity: 'low', withTools: true })
			};
			const r = toResponsesRequest(body as never);
			expect(r.tools).toHaveLength(CHAT_TOOLS.length);
			expect(r.instructions).toBe('S');
		}
	});
});

describe('fromResponsesResponse', () => {
	it('tekst, verktøykall med call_id, tokenbruk og elementene på meldingen', () => {
		const c = fromResponsesResponse(response({ output: [reasoningItem, messageItem, callItem] as never }));
		const m = c.choices[0].message as BridgedAssistantMessage;
		expect(m.content).toBe('Du er litt sliten.');
		expect(m.tool_calls).toEqual([{ id: 'call_abc', type: 'function', function: { name: 'query_training', arguments: '{"queryType":"load"}' } }]);
		expect(m[RESPONSES_OUTPUT_KEY]).toHaveLength(3);
		expect(c.choices[0].finish_reason).toBe('tool_calls');
		expect(c.usage).toEqual({
			prompt_tokens: 1200,
			completion_tokens: 80,
			total_tokens: 1280,
			prompt_tokens_details: { cached_tokens: 1024 },
			completion_tokens_details: { reasoning_tokens: 64 }
		});
		expect(c.model).toBe('gpt-5.4-2026-03-05');
	});

	it('et svar kappet av token-taket er «length», som i Chat Completions', () => {
		const c = fromResponsesResponse(response({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }));
		expect(c.choices[0].finish_reason).toBe('length');
		expect(c.choices[0].message.content).toBeNull();
	});

	it('et feilet svar kaster med koden', () => {
		expect(() => fromResponsesResponse(response({ status: 'failed', error: { code: 'server_error', message: 'nede' } as never }))).toThrow(/server_error/);
	});
});

describe('ResponsesStreamCollector', () => {
	const ev = (e: Record<string, unknown>) => e as unknown as ResponseStreamEvent;
	it('sier fra om tekst og verktøykall underveis, og bygger svaret av den avsluttende responsen', () => {
		const s = new ResponsesStreamCollector();
		expect(s.push(ev({ type: 'response.created' }))).toBeNull();
		expect(s.push(ev({ type: 'response.output_item.added', item: callItem }))).toEqual({ kind: 'tool_call', name: 'query_training' });
		expect(s.push(ev({ type: 'response.output_text.delta', delta: 'Du ' }))).toEqual({ kind: 'text', delta: 'Du ' });
		expect(s.push(ev({ type: 'response.completed', response: response({ output: [messageItem] as never }) }))).toEqual({ kind: 'done' });
		expect(s.result().choices[0].message.content).toBe('Du er litt sliten.');
	});

	it('en feilhendelse kaster, og en strøm uten slutt gir ikke et svar', () => {
		expect(() => new ResponsesStreamCollector().push(ev({ type: 'error', code: 'rate_limit', message: 'vent' }))).toThrow(/rate_limit/);
		expect(() => new ResponsesStreamCollector().result()).toThrow(/uten et ferdig svar/);
	});
});
