import { describe, it, expect } from 'vitest';
import {
	deriveHourlyDistance,
	deriveMonthlyDistance,
	computeCostPerKm,
	utcHourKey,
	utcMonthKey,
	type OdometerSample
} from './tesla-metrics';

function sample(iso: string, odometerKm: number): OdometerSample {
	return { timestamp: new Date(iso), odometerKm };
}

describe('utcHourKey / utcMonthKey', () => {
	it('runder time ned til hel UTC-time', () => {
		expect(utcHourKey(new Date('2026-06-19T14:47:31.500Z'))).toBe('2026-06-19T14:00:00.000Z');
	});

	it('gir måned-nøkkel med nullpadding', () => {
		expect(utcMonthKey(new Date('2026-03-02T00:00:00Z'))).toBe('2026-03');
	});
});

describe('deriveHourlyDistance', () => {
	it('summerer odometer-delta inn i slutt-målingens time', () => {
		const result = deriveHourlyDistance([
			sample('2026-06-19T08:00:00Z', 1000),
			sample('2026-06-19T08:15:00Z', 1010), // +10 → time 08
			sample('2026-06-19T08:45:00Z', 1025), // +15 → time 08
			sample('2026-06-19T09:10:00Z', 1030) // +5 → time 09
		]);
		expect(result).toEqual([
			{ key: '2026-06-19T08:00:00.000Z', km: 25 },
			{ key: '2026-06-19T09:00:00.000Z', km: 5 }
		]);
	});

	it('ignorerer negative og null-deltaer (parkert / odometer-støy)', () => {
		const result = deriveHourlyDistance([
			sample('2026-06-19T08:00:00Z', 1000),
			sample('2026-06-19T09:00:00Z', 1000), // 0 → ingen kjøring
			sample('2026-06-19T10:00:00Z', 995), // negativ → ignoreres
			sample('2026-06-19T11:00:00Z', 1005) // +10 fra 995
		]);
		expect(result).toEqual([{ key: '2026-06-19T11:00:00.000Z', km: 10 }]);
	});

	it('tilskriver et nattgap til morgentimen (dokumentert forbehold)', () => {
		// Siste synk kl 22, neste kl 05 — hele nattens kjøring lander 05.
		const result = deriveHourlyDistance([
			sample('2026-06-18T22:00:00Z', 2000),
			sample('2026-06-19T05:00:00Z', 2080) // +80 → time 05
		]);
		expect(result).toEqual([{ key: '2026-06-19T05:00:00.000Z', km: 80 }]);
	});

	it('sorterer usorterte prøver før beregning', () => {
		const result = deriveHourlyDistance([
			sample('2026-06-19T09:10:00Z', 1030),
			sample('2026-06-19T08:00:00Z', 1000),
			sample('2026-06-19T08:15:00Z', 1010)
		]);
		expect(result).toEqual([
			{ key: '2026-06-19T08:00:00.000Z', km: 10 },
			{ key: '2026-06-19T09:00:00.000Z', km: 20 }
		]);
	});

	it('returnerer tom liste for én eller ingen prøver', () => {
		expect(deriveHourlyDistance([])).toEqual([]);
		expect(deriveHourlyDistance([sample('2026-06-19T08:00:00Z', 1000)])).toEqual([]);
	});
});

describe('deriveMonthlyDistance', () => {
	it('summerer kjørt distanse per måned', () => {
		const result = deriveMonthlyDistance([
			sample('2026-05-01T08:00:00Z', 1000),
			sample('2026-05-20T08:00:00Z', 1200), // +200 i mai
			sample('2026-06-05T08:00:00Z', 1300), // +100 i juni
			sample('2026-06-25T08:00:00Z', 1450) // +150 i juni
		]);
		expect(result).toEqual([
			{ key: '2026-05', km: 200 },
			{ key: '2026-06', km: 250 }
		]);
	});
});

describe('computeCostPerKm', () => {
	it('regner kr/km = kostnad / km per måned', () => {
		const result = computeCostPerKm(
			[
				{ key: '2026-05', km: 1000 },
				{ key: '2026-06', km: 500 }
			],
			[
				{ month: '2026-05', cost: 2500 }, // 2.50 kr/km
				{ month: '2026-06', cost: 2000 } // 4.00 kr/km
			]
		);
		expect(result).toEqual([
			{ month: '2026-05', km: 1000, cost: 2500, krPerKm: 2.5 },
			{ month: '2026-06', km: 500, cost: 2000, krPerKm: 4 }
		]);
	});

	it('gir krPerKm = null når det ikke er kjørt (unngår deling på null)', () => {
		const result = computeCostPerKm([], [{ month: '2026-06', cost: 1500 }]);
		expect(result).toEqual([{ month: '2026-06', km: 0, cost: 1500, krPerKm: null }]);
	});

	it('slår sammen måneder fra begge kilder', () => {
		const result = computeCostPerKm(
			[{ key: '2026-06', km: 400 }],
			[{ month: '2026-05', cost: 800 }]
		);
		expect(result).toEqual([
			{ month: '2026-05', km: 0, cost: 800, krPerKm: null },
			{ month: '2026-06', km: 400, cost: 0, krPerKm: 0 }
		]);
	});
});
