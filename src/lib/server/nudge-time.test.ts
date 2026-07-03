import { describe, it, expect } from 'vitest';
import { tzOffsetMs, localDayUtcRange, isoWithTzOffset } from './nudge-time';

describe('tzOffsetMs', () => {
	it('gir +2t for Oslo sommerstid og +1t for vintertid', () => {
		expect(tzOffsetMs('Europe/Oslo', new Date('2026-07-03T12:00:00Z'))).toBe(2 * 3600_000);
		expect(tzOffsetMs('Europe/Oslo', new Date('2026-01-15T12:00:00Z'))).toBe(1 * 3600_000);
	});

	it('gir 0 for UTC', () => {
		expect(tzOffsetMs('UTC', new Date('2026-07-03T12:00:00Z'))).toBe(0);
	});

	it('håndterer negative offsets (New York)', () => {
		expect(tzOffsetMs('America/New_York', new Date('2026-07-03T12:00:00Z'))).toBe(-4 * 3600_000);
	});
});

describe('localDayUtcRange', () => {
	it('gir [22:00 i går, 22:00 i dag) UTC for en Oslo-sommerdag', () => {
		const { start, end } = localDayUtcRange('2026-07-03', 'Europe/Oslo');
		expect(start.toISOString()).toBe('2026-07-02T22:00:00.000Z');
		expect(end.toISOString()).toBe('2026-07-03T22:00:00.000Z');
	});

	it('håndterer DST-overgangsdagen (23 timer lang i mars)', () => {
		// Sommertid starter 29. mars 2026 i Europa — dagen er 23 timer.
		const { start, end } = localDayUtcRange('2026-03-29', 'Europe/Oslo');
		expect(start.toISOString()).toBe('2026-03-28T23:00:00.000Z');
		expect(end.toISOString()).toBe('2026-03-29T22:00:00.000Z');
	});

	it('er identisk med kalenderdagen for UTC', () => {
		const { start, end } = localDayUtcRange('2026-07-03', 'UTC');
		expect(start.toISOString()).toBe('2026-07-03T00:00:00.000Z');
		expect(end.toISOString()).toBe('2026-07-04T00:00:00.000Z');
	});
});

describe('isoWithTzOffset', () => {
	it('formaterer med +02:00 for Oslo sommerstid', () => {
		expect(isoWithTzOffset(new Date('2026-07-03T07:15:00Z'), 'Europe/Oslo')).toBe(
			'2026-07-03T09:15:00+02:00'
		);
	});

	it('formaterer med negativ offset', () => {
		expect(isoWithTzOffset(new Date('2026-07-03T02:30:00Z'), 'America/New_York')).toBe(
			'2026-07-02T22:30:00-04:00'
		);
	});

	it('dropper millisekunder', () => {
		expect(isoWithTzOffset(new Date('2026-07-03T07:15:00.789Z'), 'UTC')).toBe(
			'2026-07-03T07:15:00+00:00'
		);
	});
});
