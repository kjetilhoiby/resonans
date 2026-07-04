import { describe, it, expect } from 'vitest';
import { buildSearchSnippet } from './chat-search-snippet';

describe('buildSearchSnippet', () => {
	it('markerer treffet', () => {
		const parts = buildSearchSnippet('Vi var på hytta med barna', 'hytta');
		expect(parts.map((p) => p.text).join('')).toBe('Vi var på hytta med barna');
		expect(parts.find((p) => p.hit)?.text).toBe('hytta');
	});

	it('er case-insensitivt men beholder original tekst', () => {
		const parts = buildSearchSnippet('Trening i dag', 'TRENING');
		expect(parts.find((p) => p.hit)?.text).toBe('Trening');
	});

	it('kutter med ellipse rundt treffet i lang tekst', () => {
		const lang = 'a'.repeat(200) + ' hytta ' + 'b'.repeat(200);
		const parts = buildSearchSnippet(lang, 'hytta', 30);
		const joined = parts.map((p) => p.text).join('');
		expect(joined.startsWith('…')).toBe(true);
		expect(joined.endsWith('…')).toBe(true);
		expect(joined.length).toBeLessThan(120);
		expect(parts.find((p) => p.hit)?.text).toBe('hytta');
	});

	it('gir starten av teksten uten treff', () => {
		const parts = buildSearchSnippet('kort melding', 'finnesikke');
		expect(parts).toEqual([{ text: 'kort melding', hit: false }]);
	});

	it('normaliserer whitespace og linjeskift', () => {
		const parts = buildSearchSnippet('linje1\n\nlinje2   med  hytta', 'hytta');
		expect(parts.map((p) => p.text).join('')).toBe('linje1 linje2 med hytta');
	});
});
