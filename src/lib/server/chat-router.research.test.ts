import { describe, it, expect } from 'vitest';
import { routeChatRequest } from './chat-router';

describe('routeChatRequest — forceWebSearch', () => {
	it('tvinger websøk for reise/steds-spørsmål', () => {
		const d = routeChatRequest('Hva kan jeg gjøre i Hornbæk?');
		expect(d.forceWebSearch).toBe(true);
		expect(d.hints.some((h) => /web_search/.test(h))).toBe(true);
	});

	it('tvinger websøk for ferske/nyhets-spørsmål', () => {
		const d = routeChatRequest('siste nytt om renteøkningen');
		expect(d.forceWebSearch).toBe(true);
	});

	it('tvinger IKKE websøk for tidløse spørsmål', () => {
		const d = routeChatRequest('hvordan bør jeg strukturere treningsuka mi?');
		expect(d.forceWebSearch).toBe(false);
	});
});
