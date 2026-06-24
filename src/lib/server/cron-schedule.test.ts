import { describe, it, expect } from 'vitest';
import { cronMatches, mostRecentMatch, isDue } from './cron-schedule';

// Alle tider tolkes som UTC (vitest kjører med TZ=UTC).
const at = (iso: string) => new Date(iso);

describe('cronMatches', () => {
	it('matcher hvert 5. minutt for */5', () => {
		expect(cronMatches('*/5 * * * *', at('2026-06-24T00:05:00Z'))).toBe(true);
		expect(cronMatches('*/5 * * * *', at('2026-06-24T00:07:00Z'))).toBe(false);
	});

	it('matcher tidsvindu for withings (*/5 5-22)', () => {
		expect(cronMatches('*/5 5-22 * * *', at('2026-06-24T17:30:00Z'))).toBe(true);
		// utenfor vinduet (03:00 UTC)
		expect(cronMatches('*/5 5-22 * * *', at('2026-06-24T03:00:00Z'))).toBe(false);
	});

	it('matcher kun midnatt for daglig 0 0', () => {
		expect(cronMatches('0 0 * * *', at('2026-06-24T00:00:00Z'))).toBe(true);
		expect(cronMatches('0 0 * * *', at('2026-06-24T00:01:00Z'))).toBe(false);
	});

	it('matcher ukedag for lørdag (* * * * 6)', () => {
		// 2026-06-20 er en lørdag
		expect(cronMatches('*/15 * * * 6', at('2026-06-20T08:00:00Z'))).toBe(true);
		expect(cronMatches('*/15 * * * 6', at('2026-06-24T08:00:00Z'))).toBe(false);
	});
});

describe('mostRecentMatch', () => {
	it('finner siste */5-slot innenfor vinduet', () => {
		const slot = mostRecentMatch('*/5 * * * *', at('2026-06-24T00:07:30Z'));
		expect(slot?.toISOString()).toBe('2026-06-24T00:05:00.000Z');
	});

	it('fanger et forsinket midnatt-slot innenfor 60 min', () => {
		// Dispatcheren fyrer 25 min for sent
		const slot = mostRecentMatch('0 0 * * *', at('2026-06-24T00:25:00Z'));
		expect(slot?.toISOString()).toBe('2026-06-24T00:00:00.000Z');
	});

	it('returnerer null når slotet er eldre enn vinduet', () => {
		const slot = mostRecentMatch('0 0 * * *', at('2026-06-24T01:30:00Z'));
		expect(slot).toBeNull();
	});
});

describe('isDue', () => {
	it('er due første gang (ingen tidligere kjøring)', () => {
		expect(isDue('0 0 * * *', at('2026-06-24T00:05:00Z'), null)).toBe(true);
	});

	it('fanger forsinket daglig jobb selv om dispatch er sen', () => {
		// Sist kjørt i går; midnatt i dag bommet og dispatch kom 30 min for sent
		const lastRun = at('2026-06-23T00:00:30Z');
		expect(isDue('0 0 * * *', at('2026-06-24T00:30:00Z'), lastRun)).toBe(true);
	});

	it('kjører ikke daglig jobb to ganger for samme slot', () => {
		// Allerede kjørt 00:00 i dag; ny dispatch 00:20 skal ikke kjøre igjen
		const lastRun = at('2026-06-24T00:00:45Z');
		expect(isDue('0 0 * * *', at('2026-06-24T00:20:00Z'), lastRun)).toBe(false);
	});

	it('kjører */5-jobb hvert slot uten duplikat innen samme slot', () => {
		// Forrige kjøring 00:05; ny dispatch 00:07 → slot 00:05 allerede kjørt
		expect(isDue('*/5 * * * *', at('2026-06-24T00:07:00Z'), at('2026-06-24T00:05:20Z'))).toBe(false);
		// Dispatch 00:10 → nytt slot, due
		expect(isDue('*/5 * * * *', at('2026-06-24T00:10:00Z'), at('2026-06-24T00:05:20Z'))).toBe(true);
	});

	it('er ikke due utenfor jobbens tidsvindu', () => {
		// withings kjører kun 05–22 UTC; 03:00 har ingen matchende slot
		expect(isDue('*/5 5-22 * * *', at('2026-06-24T03:00:00Z'), null)).toBe(false);
	});
});
