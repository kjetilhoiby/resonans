import { describe, it, expect } from 'vitest';
import { osloWallClockToUtc } from './oslo-time';

/** Hva et UTC-tidspunkt heter på Osloklokka — for å verifisere rundturen. */
function asOslo(date: Date): string {
	return new Intl.DateTimeFormat('sv-SE', {
		timeZone: 'Europe/Oslo',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).format(date);
}

describe('osloWallClockToUtc', () => {
	it('trekker fra sommertidsoffset (UTC+2)', () => {
		// Lørdag 1. august 22:00 norsk tid er 20:00 UTC.
		expect(osloWallClockToUtc('2026-08-01', '22:00')?.toISOString()).toBe('2026-08-01T20:00:00.000Z');
	});

	it('trekker fra vintertidsoffset (UTC+1)', () => {
		expect(osloWallClockToUtc('2026-01-15', '22:00')?.toISOString()).toBe('2026-01-15T21:00:00.000Z');
	});

	it('rundturen gir tilbake klokkeslettet man ba om', () => {
		for (const [date, time] of [
			['2026-08-01', '22:00'],
			['2026-08-01', '23:59'],
			['2026-01-15', '00:00'],
			['2026-06-21', '12:30'],
			['2026-12-24', '17:45']
		] as [string, string][]) {
			const utc = osloWallClockToUtc(date, time);
			expect(asOslo(utc!), `${date} ${time}`).toBe(`${date} ${time}`);
		}
	});

	it('krysser døgnskillet riktig', () => {
		// 00:30 norsk tid om sommeren er 22:30 UTC dagen FØR.
		expect(osloWallClockToUtc('2026-08-02', '00:30')?.toISOString()).toBe('2026-08-01T22:30:00.000Z');
	});

	it('håndterer overgangsdøgnene uten å kaste', () => {
		// Klokka stilles fram natt til 29. mars 2026 og tilbake 25. oktober.
		expect(osloWallClockToUtc('2026-03-29', '02:30')).toBeInstanceOf(Date);
		expect(osloWallClockToUtc('2026-10-25', '02:30')).toBeInstanceOf(Date);
	});

	it('avviser ugyldig format', () => {
		expect(osloWallClockToUtc('1. august', '22:00')).toBeNull();
		expect(osloWallClockToUtc('2026-08-01', '22')).toBeNull();
		expect(osloWallClockToUtc('2026-08-01', '10.30')).toBeNull();
		expect(osloWallClockToUtc('', '')).toBeNull();
	});

	it('avviser klokkeslett som ikke finnes', () => {
		expect(osloWallClockToUtc('2026-08-01', '25:00')).toBeNull();
		expect(osloWallClockToUtc('2026-08-01', '22:75')).toBeNull();
	});
});
