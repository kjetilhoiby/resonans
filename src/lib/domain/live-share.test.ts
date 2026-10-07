import { describe, expect, it } from 'vitest';
import {
	describeLiveShare,
	estimatedArrival,
	formatDistanceLeft,
	formatMinutesLeft,
	formatOsloClock,
	splitRouteAtPosition,
	type LiveShareInput
} from './live-share';

const base: LiveShareInput = {
	destLabel: 'Hytta',
	etaSeconds: 23 * 60,
	// 15:19 UTC = 17:19 Oslo (sommertid)
	lastPingAt: '2026-08-14T15:19:00Z',
	lastLat: 59.9,
	lastLon: 10.7,
	endedAt: null,
	endedReason: null
};
const now = new Date('2026-08-14T15:20:00Z');

describe('formatOsloClock', () => {
	it('skriver Oslo-tid, ikke UTC', () => {
		expect(formatOsloClock(new Date('2026-08-14T15:42:00Z'))).toBe('17:42');
		expect(formatOsloClock(new Date('2026-01-14T15:42:00Z'))).toBe('16:42');
	});
});

describe('estimatedArrival', () => {
	it('regner fra siste ping, ikke fra nå', () => {
		expect(estimatedArrival(600, '2026-08-14T15:00:00Z')?.toISOString()).toBe(
			'2026-08-14T15:10:00.000Z'
		);
	});

	it('er null uten ping eller uten ETA', () => {
		expect(estimatedArrival(600, null)).toBeNull();
		expect(estimatedArrival(null, '2026-08-14T15:00:00Z')).toBeNull();
		expect(estimatedArrival(-5, '2026-08-14T15:00:00Z')).toBeNull();
	});
});

describe('describeLiveShare', () => {
	it('sier «Jeg er på vei» og klokkeslettet for ankomst', () => {
		const s = describeLiveShare(base, now);
		expect(s.title).toBe('Jeg er på vei');
		expect(s.description).toBe('Til Hytta · framme ca. kl. 17:42');
		expect(s.arrivalClock).toBe('17:42');
		expect(s.minutesLeft).toBe(22);
	});

	it('nevner ikke navnet til den som deler', () => {
		const s = describeLiveShare(base, now);
		expect(`${s.title} ${s.description}`).not.toMatch(/underveis/);
	});

	it('uten ETA lover den ingen ankomsttid', () => {
		const s = describeLiveShare({ ...base, etaSeconds: null }, now);
		expect(s.description).toBe('På vei til Hytta · følg turen live');
		expect(s.arrivalClock).toBeNull();
	});

	it('uten mål og uten ETA', () => {
		expect(describeLiveShare({ ...base, etaSeconds: null, destLabel: null }, now).description).toBe(
			'Følg turen live'
		);
	});

	it('venter på første posisjon', () => {
		expect(describeLiveShare({ ...base, lastLat: null, lastLon: null }, now).state).toBe('waiting');
	});

	it('en ankomst som er passert gir 0 minutter, ikke et negativt tall', () => {
		const s = describeLiveShare(base, new Date('2026-08-14T16:00:00Z'));
		expect(s.minutesLeft).toBe(0);
	});

	it('framme: faktisk ankomsttid', () => {
		const s = describeLiveShare(
			{ ...base, endedAt: '2026-08-14T15:40:00Z', endedReason: 'arrived' },
			now
		);
		expect(s.state).toBe('arrived');
		expect(s.title).toBe('Jeg er framme');
		expect(s.description).toBe('Hytta · framme kl. 17:40');
		expect(s.minutesLeft).toBeNull();
	});

	it('avsluttet uten ankomst', () => {
		const s = describeLiveShare({ ...base, endedAt: '2026-08-14T15:40:00Z', endedReason: 'stopped' });
		expect(s.state).toBe('ended');
		expect(s.arrivalClock).toBeNull();
	});
});

describe('formatering', () => {
	it('minutter igjen', () => {
		expect(formatMinutesLeft(null)).toBeNull();
		expect(formatMinutesLeft(0)).toBe('snart framme');
		expect(formatMinutesLeft(23)).toBe('om 23 min');
		expect(formatMinutesLeft(60)).toBe('om 1 t');
		expect(formatMinutesLeft(65)).toBe('om 1 t 5 min');
	});

	it('distanse med desimalkomma', () => {
		expect(formatDistanceLeft(4230)).toBe('4,2 km');
		expect(formatDistanceLeft(12_600)).toBe('13 km');
		expect(formatDistanceLeft(846)).toBe('850 m');
		expect(formatDistanceLeft(null)).toBeNull();
	});
});

describe('splitRouteAtPosition', () => {
	it('deler ved nærmeste punkt og skjøter posisjonen inn i begge', () => {
		const route: [number, number][] = [
			[0, 0],
			[0, 1],
			[0, 2],
			[0, 3]
		];
		const { done, remaining } = splitRouteAtPosition(route, 0.1, 1.1);
		expect(done).toEqual([[0, 0], [0, 1], [0.1, 1.1]]);
		expect(remaining).toEqual([[0.1, 1.1], [0, 2], [0, 3]]);
	});
});
