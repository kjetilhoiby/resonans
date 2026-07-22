import { describe, it, expect } from 'vitest';
import { extractFirstUrl, parseLinkPreview } from './og-tags';

describe('extractFirstUrl', () => {
	it('finner første URL i en tekst', () => {
		expect(extractFirstUrl('Se denne https://www.instagram.com/reel/ABC123/ kul!')).toBe(
			'https://www.instagram.com/reel/ABC123/'
		);
	});

	it('stripper hale-tegnsetting', () => {
		expect(extractFirstUrl('Lenke: https://example.com/oppskrift.')).toBe(
			'https://example.com/oppskrift'
		);
		expect(extractFirstUrl('(https://example.com/x)')).toBe('https://example.com/x');
	});

	it('returnerer null uten URL', () => {
		expect(extractFirstUrl('ingen lenke her')).toBeNull();
		expect(extractFirstUrl('')).toBeNull();
		expect(extractFirstUrl(null)).toBeNull();
	});
});

describe('parseLinkPreview', () => {
	it('leser OpenGraph-tagger', () => {
		const html = `<!doctype html><html><head>
			<meta property="og:title" content="Kjetil on Instagram: manuell dovetail på 5 min" />
			<meta property="og:description" content="Slik skjærer du en sinke uten maskiner" />
			<meta property="og:image" content="https://cdn.example.com/thumb.jpg" />
			<meta property="og:site_name" content="Instagram" />
			<title>Instagram</title>
		</head><body></body></html>`;
		const p = parseLinkPreview(html, 'https://instagram.com/reel/x');
		expect(p.title).toBe('Kjetil on Instagram: manuell dovetail på 5 min');
		expect(p.description).toBe('Slik skjærer du en sinke uten maskiner');
		expect(p.image).toBe('https://cdn.example.com/thumb.jpg');
		expect(p.siteName).toBe('Instagram');
	});

	it('takler omvendt attributt-rekkefølge og name= i stedet for property=', () => {
		const html = `<meta content="Tittel her" name="og:title">`;
		expect(parseLinkPreview(html, 'u').title).toBe('Tittel her');
	});

	it('faller tilbake til <title> og dekoder entiteter', () => {
		const html = `<head><title>Fisk &amp; skalldyr</title></head>`;
		const p = parseLinkPreview(html, 'u');
		expect(p.title).toBe('Fisk & skalldyr');
		expect(p.description).toBeNull();
		expect(p.image).toBeNull();
	});
});
