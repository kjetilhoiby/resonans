import { describe, it, expect } from 'vitest';
import { checkNotStale } from './concurrency';

describe('checkNotStale', () => {
	const base = new Date('2026-08-07T12:00:00.000Z');

	it('godtar skriving når klienten har siste versjon', () => {
		expect(checkNotStale(base, base.toISOString())).toEqual({ ok: true });
	});

	it('godtar at klienten er nyere enn basen', () => {
		// Skjer når to skrivinger kommer tett og klienten alt har fått forrige svar.
		const nyere = new Date('2026-08-07T12:00:05.000Z');
		expect(checkNotStale(base, nyere.toISOString())).toEqual({ ok: true });
	});

	it('nekter når basen er endret etter at klienten lastet', () => {
		const iBasen = new Date('2026-08-07T12:05:00.000Z');
		const result = checkNotStale(iBasen, base.toISOString());
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('utdatert');
	});

	it('tåler 1 ms avrunding uten å melde kollisjon', () => {
		const ettMsNyere = new Date(base.getTime() + 1);
		expect(checkNotStale(ettMsNyere, base.toISOString())).toEqual({ ok: true });
	});

	it('melder kollisjon fra og med 2 ms', () => {
		const toMsNyere = new Date(base.getTime() + 2);
		expect(checkNotStale(toMsNyere, base.toISOString()).ok).toBe(false);
	});

	it('krever gyldig tidsstempel fra klienten', () => {
		const result = checkNotStale(base, undefined);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('ugyldig-tidsstempel');

		const tull = checkNotStale(base, 'ikke-en-dato');
		expect(tull.ok).toBe(false);
		if (!tull.ok) expect(tull.reason).toBe('ugyldig-tidsstempel');
	});

	it('sier hvor gammel versjonen er, siden det avgjør hva du gjør videre', () => {
		const treMinutter = new Date(base.getTime() + 3 * 60 * 1000);
		const result = checkNotStale(treMinutter, base.toISOString());
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain('3 minutter');

		const toTimer = new Date(base.getTime() + 2 * 60 * 60 * 1000);
		const sent = checkNotStale(toTimer, base.toISOString());
		if (!sent.ok) expect(sent.message).toContain('2 timer');

		const ettSekund = new Date(base.getTime() + 1000);
		const naa = checkNotStale(ettSekund, base.toISOString());
		if (!naa.ok) expect(naa.message).toContain('1 sekund');
	});

	it('ber aldri brukeren om å miste teksten sin', () => {
		const result = checkNotStale(new Date(base.getTime() + 60_000), base.toISOString());
		if (!result.ok) expect(result.message).toMatch(/kopier/i);
	});
});
