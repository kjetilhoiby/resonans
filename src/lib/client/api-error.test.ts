import { describe, it, expect } from 'vitest';
import { extractApiErrorMessage } from './api-error';

describe('extractApiErrorMessage', () => {
	it('plukker error-feltet fra våre håndterte feil', () => {
		expect(extractApiErrorMessage(400, JSON.stringify({ error: 'Temaet har ikke søvndashboard.' }))).toBe(
			'HTTP 400: Temaet har ikke søvndashboard.'
		);
	});

	it('plukker message og errorId fra handleError-svaret', () => {
		// errorId gjentas i serverloggen, så den skal med i teksten brukeren ser.
		expect(
			extractApiErrorMessage(500, JSON.stringify({ message: 'rows is not iterable', errorId: 'a1b2c3d4' }))
		).toBe('HTTP 500: rows is not iterable (a1b2c3d4)');
	});

	it('foretrekker error over message når begge finnes', () => {
		expect(extractApiErrorMessage(404, JSON.stringify({ error: 'Tema ikke funnet.', message: 'Not Found' }))).toBe(
			'HTTP 404: Tema ikke funnet.'
		);
	});

	it('henter tittelen ut av en HTML-feilside i stedet for å vise markup', () => {
		const html = '<!doctype html><html><head><title>500 — Internal Error</title></head><body>…</body></html>';
		expect(extractApiErrorMessage(500, html)).toBe('HTTP 500: 500 — Internal Error');
	});

	it('gir bare statuskoden for HTML uten tittel', () => {
		expect(extractApiErrorMessage(502, '<html><body>Bad Gateway</body></html>')).toBe('HTTP 502');
	});

	it('gir bare statuskoden for tom kropp', () => {
		expect(extractApiErrorMessage(500, '')).toBe('HTTP 500');
		expect(extractApiErrorMessage(500, '   ')).toBe('HTTP 500');
	});

	it('tar med ren tekst som ikke er JSON eller HTML', () => {
		expect(extractApiErrorMessage(504, 'Gateway timeout etter 10s')).toBe('HTTP 504: Gateway timeout etter 10s');
	});

	it('kutter lang tekstkropp', () => {
		const out = extractApiErrorMessage(500, 'x'.repeat(500));
		expect(out.length).toBeLessThan(220);
	});

	it('faller tilbake til statuskoden når JSON-en ikke har error eller message', () => {
		expect(extractApiErrorMessage(500, JSON.stringify({ detail: 'noe' }))).toContain('HTTP 500');
	});
});
