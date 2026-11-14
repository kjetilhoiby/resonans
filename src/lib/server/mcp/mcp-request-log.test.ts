import { describe, expect, it } from 'vitest';
import { describeMcpBody } from './mcp-request-log';

describe('describeMcpBody', () => {
	it('leser metoden og klienten fra initialize', () => {
		expect(
			describeMcpBody({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: { protocolVersion: '2025-06-18', clientInfo: { name: 'openai-mcp', version: '1.0.0' } }
			})
		).toEqual({ methods: ['initialize'], client: 'openai-mcp@1.0.0 protokoll=2025-06-18' });
	});

	it('håndterer batch og logger aldri argumentene', () => {
		const result = describeMcpBody([
			{ method: 'tools/list' },
			{ method: 'tools/call', params: { name: 'query_groceries', arguments: { search: 'privat' } } }
		]);
		expect(result).toEqual({ methods: ['tools/list', 'tools/call'], client: null });
		expect(JSON.stringify(result)).not.toContain('privat');
	});

	it('tåler en kropp som ikke er JSON-RPC', () => {
		expect(describeMcpBody(null)).toEqual({ methods: [], client: null });
		expect(describeMcpBody('tull')).toEqual({ methods: [], client: null });
	});
});
