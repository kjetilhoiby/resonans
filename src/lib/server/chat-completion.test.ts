import { describe, it, expect, vi } from 'vitest';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import { createChatCompletionWithFallback, type ChatCompletionClient } from './chat-completion';

type Listener = (props: { delta: string }) => void;

function completion(content: string | null, toolCalls = false, model = 'gpt-5.4-2026-03-05'): ChatCompletion {
	return {
		id: 'c',
		object: 'chat.completion',
		created: 0,
		model,
		choices: [
			{
				index: 0,
				finish_reason: toolCalls ? 'tool_calls' : 'stop',
				logprobs: null,
				message: {
					role: 'assistant',
					content,
					refusal: null,
					...(toolCalls
						? {
								tool_calls: [
									{ id: 't', type: 'function' as const, function: { name: 'query_weight', arguments: '{}' } }
								]
							}
						: {})
				}
			}
		]
	};
}

/**
 * En falsk klient. `streams` er det hver `stream()`-kall skal gjøre, i
 * rekkefølge: ord å sende, så enten et ferdig svar eller en feil.
 */
function fakeClient(streams: Array<{ deltas?: string[]; result?: ChatCompletion; error?: { status: number } }>) {
	const requests: Array<Record<string, unknown>> = [];
	const create = vi.fn(async () => completion('ikke strømmet'));
	const stream = vi.fn((req: Record<string, unknown>) => {
		requests.push(req);
		const plan = streams.shift()!;
		const listeners: Record<string, Listener[]> = {};
		return {
			on(event: string, cb: Listener) {
				(listeners[event] ??= []).push(cb);
				return this;
			},
			async finalChatCompletion() {
				for (const d of plan.deltas ?? []) for (const cb of listeners['content.delta'] ?? []) cb({ delta: d });
				if (plan.error) throw Object.assign(new Error('avvist'), plan.error);
				return plan.result!;
			}
		};
	});
	const client = { chat: { completions: { create, stream } } } as unknown as ChatCompletionClient;
	return { client, create, stream, requests };
}

const request = {
	model: 'gpt-5.4',
	messages: [{ role: 'user' as const, content: 'hei' }],
	max_completion_tokens: 4000,
	reasoning_effort: 'low' as const,
	verbosity: 'low' as const
};
const sizing = { temperature: 0.8, maxTokens: 1000 };

function hooks() {
	const tokens: string[] = [];
	let resets = 0;
	return {
		tokens,
		get resets() {
			return resets;
		},
		stream: {
			onDelta: (t: string) => tokens.push(t),
			onReset: () => {
				resets += 1;
			}
		}
	};
}

describe('createChatCompletionWithFallback', () => {
	it('strømmer ikke uten lyttere — POST /api/chat svarer med JSON', async () => {
		const { client, create, stream } = fakeClient([]);
		const result = await createChatCompletionWithFallback(client, request, sizing);
		expect(create).toHaveBeenCalledOnce();
		expect(stream).not.toHaveBeenCalled();
		expect(result.choices[0].message.content).toBe('ikke strømmet');
	});

	it('sender ordene videre og returnerer hele svaret', async () => {
		const h = hooks();
		const { client } = fakeClient([{ deltas: ['Ned ', '0,4 kg.'], result: completion('Ned 0,4 kg.') }]);
		const result = await createChatCompletionWithFallback(client, request, sizing, { stream: h.stream });
		expect(h.tokens).toEqual(['Ned ', '0,4 kg.']);
		expect(h.resets).toBe(0);
		expect(result.choices[0].message.content).toBe('Ned 0,4 kg.');
	});

	it('nullstiller praten før et verktøykall — den er ikke svaret', async () => {
		const h = hooks();
		const { client } = fakeClient([{ deltas: ['La meg sjekke …'], result: completion('La meg sjekke …', true) }]);
		const result = await createChatCompletionWithFallback(client, request, sizing, { stream: h.stream });
		expect(h.resets).toBe(1);
		expect(result.choices[0].message.tool_calls).toHaveLength(1);
	});

	it('nullstiller ikke et verktøykall uten prat', async () => {
		const h = hooks();
		const { client } = fakeClient([{ result: completion(null, true) }]);
		await createChatCompletionWithFallback(client, request, sizing, { stream: h.stream });
		expect(h.resets).toBe(0);
	});

	it('faller tilbake på gpt-4o med de gamle parameterne når modellen avvises', async () => {
		const h = hooks();
		const onFallback = vi.fn();
		const { client, requests } = fakeClient([
			{ error: { status: 400 } },
			{ deltas: ['Hei'], result: completion('Hei', false, 'gpt-4o-2024-08-06') }
		]);
		const result = await createChatCompletionWithFallback(client, request, sizing, {
			stream: h.stream,
			onFallback
		});
		expect(onFallback).toHaveBeenCalledOnce();
		expect(result.model).toBe('gpt-4o-2024-08-06');
		expect(requests[1]).toMatchObject({ model: 'gpt-4o', temperature: 0.8, max_tokens: 1000, stream: true });
		expect(requests[1]).not.toHaveProperty('reasoning_effort');
		expect(requests[1]).not.toHaveProperty('verbosity');
		expect(requests[1]).not.toHaveProperty('max_completion_tokens');
	});

	it('faller IKKE tilbake når brukeren alt har sett tekst', async () => {
		const h = hooks();
		const onFallback = vi.fn();
		const { client, stream } = fakeClient([{ deltas: ['Halvt svar'], error: { status: 400 } }]);
		await expect(
			createChatCompletionWithFallback(client, request, sizing, { stream: h.stream, onFallback })
		).rejects.toThrow('avvist');
		expect(onFallback).not.toHaveBeenCalled();
		expect(stream).toHaveBeenCalledOnce();
	});

	it('faller ikke tilbake ved rate limit', async () => {
		const h = hooks();
		const { client, stream } = fakeClient([{ error: { status: 429 } }]);
		await expect(createChatCompletionWithFallback(client, request, sizing, { stream: h.stream })).rejects.toThrow();
		expect(stream).toHaveBeenCalledOnce();
	});
});
