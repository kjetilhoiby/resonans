import { describe, it, expect } from 'vitest';
import { trimSnippet, hostnameOf, buildResearchPrompt } from './web-research';

describe('trimSnippet', () => {
	it('normaliserer whitespace', () => {
		expect(trimSnippet('  hei   \n\t verden  ')).toBe('hei verden');
	});

	it('lar korte utdrag stå urørt', () => {
		expect(trimSnippet('kort tekst', 100)).toBe('kort tekst');
	});

	it('kutter lange utdrag og legger på ellipsis', () => {
		const long = 'a'.repeat(50);
		const result = trimSnippet(long, 10);
		expect(result).toBe(`${'a'.repeat(10)}…`);
		expect(result.length).toBe(11); // 10 tegn + ellipsis
	});
});

describe('hostnameOf', () => {
	it('fjerner www-prefiks', () => {
		expect(hostnameOf('https://www.visitdenmark.no/hornbaek')).toBe('visitdenmark.no');
	});

	it('beholder subdomener som ikke er www', () => {
		expect(hostnameOf('https://blog.example.com/a/b')).toBe('blog.example.com');
	});

	it('faller tilbake til input ved ugyldig URL', () => {
		expect(hostnameOf('ikke en url')).toBe('ikke en url');
	});
});

describe('buildResearchPrompt', () => {
	it('inkluderer spørsmålet og alle kilder', () => {
		const prompt = buildResearchPrompt('hva kan jeg gjøre i Hornbæk', [
			'[visitdenmark.no]\nStrand og kunstmuseum',
			'[tripadvisor.no]\nSykkelutleie'
		]);
		expect(prompt).toContain('hva kan jeg gjøre i Hornbæk');
		expect(prompt).toContain('visitdenmark.no');
		expect(prompt).toContain('tripadvisor.no');
		expect(prompt).toContain('---'); // kildeskille
	});

	it('ber om norsk, kildebasert svar uten URL-er', () => {
		const prompt = buildResearchPrompt('q', ['[a]\ntekst']);
		expect(prompt).toContain('På norsk');
		expect(prompt).toContain('KUN på kildene');
	});
});
