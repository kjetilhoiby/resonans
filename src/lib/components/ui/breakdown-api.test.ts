import { describe, it, expect } from 'vitest';
import { buildBreakdownContextFromChat, type BreakdownChatMessage } from './breakdown-api';

describe('buildBreakdownContextFromChat', () => {
	it('returnerer tom streng uten meldinger', () => {
		expect(buildBreakdownContextFromChat([])).toBe('');
	});

	it('hopper over tomme meldinger', () => {
		const messages: BreakdownChatMessage[] = [
			{ role: 'assistant', content: '   ' },
			{ role: 'user', content: '' }
		];
		expect(buildBreakdownContextFromChat(messages)).toBe('');
	});

	it('bygger transkripsjon med norske rolle-etiketter', () => {
		const messages: BreakdownChatMessage[] = [
			{ role: 'assistant', content: 'Hva er målet?' },
			{ role: 'user', content: 'Jeg vil male barnerommet før helgen.' }
		];
		expect(buildBreakdownContextFromChat(messages)).toMatchInlineSnapshot(`
			"Samtale om oppgaven:
			Assistent: Hva er målet?
			Bruker: Jeg vil male barnerommet før helgen."
		`);
	});

	it('trimmer whitespace rundt innholdet', () => {
		const messages: BreakdownChatMessage[] = [{ role: 'user', content: '  rekker det på en dag?  ' }];
		expect(buildBreakdownContextFromChat(messages)).toBe('Samtale om oppgaven:\nBruker: rekker det på en dag?');
	});
});
