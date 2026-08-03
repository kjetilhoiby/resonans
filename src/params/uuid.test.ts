import { describe, it, expect } from 'vitest';
import { match } from './uuid';

describe('uuid-matcher', () => {
	it('godtar en uuid', () => {
		expect(match('e73b0e11-d8ef-4894-b22e-3c0525a34055')).toBe(true);
	});

	it('godtar store bokstaver', () => {
		expect(match('E73B0E11-D8EF-4894-B22E-3C0525A34055')).toBe(true);
	});

	it('avviser det som ellers ga 500 fra Postgres', () => {
		// Alle disse traff `eq(themes.id, params.id)` mot en uuid-kolonne og kastet
		// på typekonverteringen. Nå svarer SvelteKit 404 før handleren kjører.
		expect(match('helse')).toBe(false);
		expect(match('123')).toBe(false);
		expect(match('abc')).toBe(false);
		expect(match('')).toBe(false);
		expect(match('undefined')).toBe(false);
		expect(match('null')).toBe(false);
	});

	it('avviser nesten-uuider', () => {
		expect(match('e73b0e11-d8ef-4894-b22e-3c0525a3405')).toBe(false);
		expect(match('e73b0e11-d8ef-4894-b22e-3c0525a340555')).toBe(false);
		expect(match('e73b0e11d8ef4894b22e3c0525a34055')).toBe(false);
		expect(match('g73b0e11-d8ef-4894-b22e-3c0525a34055')).toBe(false);
		expect(match(' e73b0e11-d8ef-4894-b22e-3c0525a34055')).toBe(false);
	});
});
