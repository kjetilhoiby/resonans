import { describe, it, expect } from 'vitest';
import type OpenAI from 'openai';
import { toAnthropicRequest } from './anthropic-adapter';

/**
 * Oversettelsen OpenAI-format → Anthropic Messages er den risikable, men rene, delen av
 * Claude-ruting. Testene låser de tre vanskelige tilfellene: system-uttrekk, tool_use i
 * assistant-meldinger, og at påfølgende tool-svar slås sammen til ÉN user-melding.
 */
type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

describe('toAnthropicRequest', () => {
	it('trekker ut system-meldinger til system-feltet og lar user-tekst stå', () => {
		const messages: Msg[] = [
			{ role: 'system', content: 'Du er en assistent.' },
			{ role: 'system', content: 'Akkurat nå er det tirsdag.' },
			{ role: 'user', content: 'Hei' }
		];
		const req = toAnthropicRequest(messages, []);
		expect(req.system).toBe('Du er en assistent.\n\nAkkurat nå er det tirsdag.');
		expect(req.messages).toEqual([{ role: 'user', content: 'Hei' }]);
	});

	it('mapper assistant tool_calls til tool_use-blokker og tool-svar til ÉN samlet user-melding', () => {
		const messages: Msg[] = [
			{ role: 'user', content: 'Hvor langt til IKEA og hva er saldoen?' },
			{
				role: 'assistant',
				content: null,
				tool_calls: [
					{ id: 'c1', type: 'function', function: { name: 'driveDistance', arguments: '{"to":"IKEA"}' } },
					{ id: 'c2', type: 'function', function: { name: 'query_economics', arguments: '{}' } }
				]
			},
			{ role: 'tool', tool_call_id: 'c1', content: '{"distanceKm":8}' },
			{ role: 'tool', tool_call_id: 'c2', content: '{"balance":1000}' }
		];
		const req = toAnthropicRequest(messages, []);

		expect(req.messages[1]).toEqual({
			role: 'assistant',
			content: [
				{ type: 'tool_use', id: 'c1', name: 'driveDistance', input: { to: 'IKEA' } },
				{ type: 'tool_use', id: 'c2', name: 'query_economics', input: {} }
			]
		});
		// Begge tool-svarene samlet i én påfølgende user-melding.
		expect(req.messages[2]).toEqual({
			role: 'user',
			content: [
				{ type: 'tool_result', tool_use_id: 'c1', content: '{"distanceKm":8}' },
				{ type: 'tool_result', tool_use_id: 'c2', content: '{"balance":1000}' }
			]
		});
		expect(req.messages).toHaveLength(3);
	});

	it('mapper OpenAI-verktøy til Anthropic-verktøy (input_schema)', () => {
		const tools: OpenAI.Chat.Completions.ChatCompletionFunctionTool[] = [
			{
				type: 'function',
				function: {
					name: 'driveDistance',
					description: 'Kjøreavstand',
					parameters: { type: 'object', properties: { to: { type: 'string' } }, required: ['to'] }
				}
			}
		];
		const req = toAnthropicRequest([], tools);
		expect(req.tools).toEqual([
			{
				name: 'driveDistance',
				description: 'Kjøreavstand',
				input_schema: { type: 'object', properties: { to: { type: 'string' } }, required: ['to'] }
			}
		]);
	});
});
