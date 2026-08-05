import { describe, it, expect } from 'vitest';
import {
	nightFetchWindow,
	NIGHT_LEAD_HOURS,
	NIGHT_TRAIL_HOURS
} from './night-window';

/** De faktiske søvnstartene fra prod 5. august — alle sent på kvelden i UTC. */
const PROD_STARTS = [
	'2026-08-04T22:53:00.000Z',
	'2026-08-03T22:16:00.000Z',
	'2026-08-02T22:48:00.000Z',
	'2026-08-01T21:37:00.000Z',
	'2026-07-31T22:54:00.000Z',
	'2026-07-30T21:51:00.000Z',
	'2026-07-29T20:57:00.000Z'
];

function iso(seconds: number): string {
	return new Date(seconds * 1000).toISOString();
}

describe('nightFetchWindow', () => {
	it('dekker natta selv når den krysser UTC-midnatt', () => {
		// Kjernen i feilen: økta starter 22:53 UTC, så et UTC-kalenderdøgn dekker bare
		// timen fram til midnatt. Vinduet må favne morgenen etter.
		const win = nightFetchWindow([new Date('2026-08-04T22:53:00Z')])!;
		expect(iso(win.startdate)).toBe('2026-08-04T20:53:00.000Z');
		expect(iso(win.enddate)).toBe('2026-08-05T16:53:00.000Z');
	});

	it('dekker morgenen for hver enkelt prod-natt', () => {
		for (const start of PROD_STARTS) {
			const win = nightFetchWindow([new Date(start)])!;
			const wakeish = new Date(start).getTime() + 7 * 3_600_000;
			// En oppvåkning sju timer etter innsovning skal ligge trygt inni vinduet.
			expect(win.startdate * 1000).toBeLessThan(new Date(start).getTime());
			expect(win.enddate * 1000).toBeGreaterThan(wakeish);
		}
	});

	it('er bredere enn det gamle UTC-døgnvinduet var for disse nettene', () => {
		// Dokumenterer regresjonen: det gamle vinduet sluttet ved midnatt UTC.
		for (const start of PROD_STARTS) {
			const oldEnd = new Date(`${start.slice(0, 10)}T23:59:59Z`).getTime();
			const win = nightFetchWindow([new Date(start)])!;
			expect(win.enddate * 1000).toBeGreaterThan(oldEnd);
		}
	});

	it('strekker seg fra første til siste segment', () => {
		// Withings deler natta når man er ute av senga. Vinduet må favne begge biter.
		const win = nightFetchWindow([
			new Date('2026-08-04T22:53:00Z'),
			new Date('2026-08-05T03:10:00Z')
		])!;
		expect(iso(win.startdate)).toBe('2026-08-04T20:53:00.000Z');
		// Enden regnes fra det siste segmentet, ikke det første.
		expect(iso(win.enddate)).toBe('2026-08-05T21:10:00.000Z');
	});

	it('bruker konstantene', () => {
		const start = new Date('2026-08-04T22:53:00Z');
		const win = nightFetchWindow([start])!;
		expect(start.getTime() - win.startdate * 1000).toBe(NIGHT_LEAD_HOURS * 3_600_000);
		expect(win.enddate * 1000 - start.getTime()).toBe(NIGHT_TRAIL_HOURS * 3_600_000);
	});

	it('gir null uten brukbare tidspunkter', () => {
		expect(nightFetchWindow([])).toBeNull();
		expect(nightFetchWindow([new Date('tull')])).toBeNull();
	});
});
