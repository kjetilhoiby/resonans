import { describe, it, expect } from 'vitest';
import { isTeslaQuietWindowUtc, shouldSyncTeslaUser } from './tesla-poll-window';

describe('isTeslaQuietWindowUtc', () => {
	it('er stille 23:00–04:59 UTC (samme timer som gammel cron-plan aldri dekket)', () => {
		expect(isTeslaQuietWindowUtc(new Date('2026-07-03T23:00:00Z'))).toBe(true);
		expect(isTeslaQuietWindowUtc(new Date('2026-07-03T02:30:00Z'))).toBe(true);
		expect(isTeslaQuietWindowUtc(new Date('2026-07-03T04:59:00Z'))).toBe(true);
	});

	it('er aktiv 05:00–22:59 UTC', () => {
		expect(isTeslaQuietWindowUtc(new Date('2026-07-03T05:00:00Z'))).toBe(false);
		expect(isTeslaQuietWindowUtc(new Date('2026-07-03T12:00:00Z'))).toBe(false);
		expect(isTeslaQuietWindowUtc(new Date('2026-07-03T22:45:00Z'))).toBe(false);
	});
});

describe('shouldSyncTeslaUser', () => {
	it('syncer alltid utenfor nattevinduet', () => {
		expect(shouldSyncTeslaUser(new Date('2026-07-03T12:00:00Z'), false)).toBe(true);
	});

	it('syncer i nattevinduet kun med aktiv trip (reisedag)', () => {
		const night = new Date('2026-07-03T02:00:00Z');
		expect(shouldSyncTeslaUser(night, true)).toBe(true);
		expect(shouldSyncTeslaUser(night, false)).toBe(false);
	});
});
