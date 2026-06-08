import { describe, it, expect } from 'vitest';
import { computeSleepLag } from './sleep-lag';

// Europe/Oslo = UTC+1 in winter (CET). All test dates use January to keep offset stable.
// To hit Oslo hour H, create UTC hour H-1.
const oslo = (hour: number, minute = 0) =>
	new Date(Date.UTC(2026, 0, 15, hour - 1, minute));

// After-midnight bed times: Oslo 00:30 on the 16th = UTC 23:30 on the 15th
const osloNextDay = (hour: number, minute = 0) =>
	new Date(Date.UTC(2026, 0, 15, hour + 23, minute));

describe('computeSleepLag', () => {
	it('perfect timing (22:00→06:00) → 0', () => {
		expect(computeSleepLag(oslo(22), oslo(6))).toBe(0);
	});

	it('late bed only (00:00→06:00) → 50', () => {
		expect(computeSleepLag(osloNextDay(0), oslo(6))).toBe(50);
	});

	it('late wake only (22:00→08:00) → 50', () => {
		expect(computeSleepLag(oslo(22), oslo(8))).toBe(50);
	});

	it('both late (00:00→08:00) → 100', () => {
		expect(computeSleepLag(osloNextDay(0), oslo(8))).toBe(100);
	});

	it('middle values (23:00→07:00) → 50', () => {
		// bedLag = clamp01((23-22)/2) = 0.5, wakeLag = clamp01((7-6)/2) = 0.5
		// score = (0.5*0.5 + 0.5*0.5) * 100 = 50
		expect(computeSleepLag(oslo(23), oslo(7))).toBe(50);
	});

	it('after midnight bed (01:00→07:00) → capped bed + partial wake', () => {
		// bedHour = 1 + 24 = 25, bedLag = clamp01((25-22)/2) = 1.0
		// wakeLag = clamp01((7-6)/2) = 0.5
		// score = (1.0*0.5 + 0.5*0.5) * 100 = 75
		expect(computeSleepLag(osloNextDay(1), oslo(7))).toBe(75);
	});

	it('returns undefined for invalid dates', () => {
		expect(computeSleepLag(new Date('invalid'), oslo(6))).toBeUndefined();
		expect(computeSleepLag(oslo(22), new Date('invalid'))).toBeUndefined();
		expect(computeSleepLag(new Date('invalid'), new Date('invalid'))).toBeUndefined();
	});

	it('returns undefined for non-Date inputs', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(computeSleepLag('22:00' as any, oslo(6))).toBeUndefined();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(computeSleepLag(oslo(22), null as any)).toBeUndefined();
	});
});
