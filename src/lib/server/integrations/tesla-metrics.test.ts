import { describe, it, expect } from 'vitest';
import {
	deriveHourlyDistance,
	deriveMonthlyDistance,
	computeCostPerKm,
	clusterPositions,
	utcHourKey,
	utcMonthKey,
	type OdometerSample,
	type PositionSample
} from './tesla-metrics';

function sample(iso: string, odometerKm: number): OdometerSample {
	return { timestamp: new Date(iso), odometerKm };
}

function pos(iso: string, lat: number, lon: number): PositionSample {
	return { timestamp: new Date(iso), lat, lon };
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

describe('clusterPositions', () => {
	// Hjemme-koordinat (Oslo) med GPS-jitter innenfor noen titalls meter.
	const HOME = { lat: 59.91, lon: 10.75 };

	it('slår sammen lang stillstand til ett stopp-punkt (ikke ett per kvarter)', () => {
		// Fem målinger over to dager, alle innenfor GPS-jitter rundt hjemme.
		const result = clusterPositions([
			pos('2026-06-20T22:00:00Z', HOME.lat, HOME.lon),
			pos('2026-06-21T05:00:00Z', HOME.lat + 0.0002, HOME.lon + 0.0003),
			pos('2026-06-21T12:00:00Z', HOME.lat - 0.0001, HOME.lon - 0.0002),
			pos('2026-06-21T22:00:00Z', HOME.lat + 0.0001, HOME.lon + 0.0001),
			pos('2026-06-22T05:00:00Z', HOME.lat, HOME.lon - 0.0003)
		]);
		expect(result).toHaveLength(1);
		expect(result[0].kind).toBe('stop');
		expect(result[0].samples).toBe(5);
		expect(result[0].from).toBe('2026-06-20T22:00:00.000Z');
		expect(result[0].to).toBe('2026-06-22T05:00:00.000Z');
		// Representativt punkt = snitt, fortsatt nær hjemme.
		expect(result[0].lat).toBeCloseTo(HOME.lat, 3);
		expect(result[0].lon).toBeCloseTo(HOME.lon, 3);
	});

	it('gir egne move-noder for kjøring og stopp for parkeringer', () => {
		const result = clusterPositions([
			// Parkert hjemme
			pos('2026-06-20T08:00:00Z', HOME.lat, HOME.lon),
			pos('2026-06-20T08:15:00Z', HOME.lat + 0.0001, HOME.lon),
			// Kjører — hvert punkt langt fra forrige
			pos('2026-06-20T08:30:00Z', 59.93, 10.78),
			pos('2026-06-20T08:45:00Z', 59.95, 10.82),
			pos('2026-06-20T09:00:00Z', 59.97, 10.86),
			// Parkert på destinasjon
			pos('2026-06-20T09:15:00Z', 59.99, 10.9),
			pos('2026-06-20T12:00:00Z', 59.9901, 10.9002)
		]);
		expect(result.map((n) => n.kind)).toEqual(['stop', 'move', 'move', 'move', 'stop']);
		expect(result.map((n) => n.samples)).toEqual([2, 1, 1, 1, 2]);
	});

	it('behandler en enslig måling som et move-punkt', () => {
		const result = clusterPositions([pos('2026-06-20T08:00:00Z', HOME.lat, HOME.lon)]);
		expect(result).toEqual([
			{
				lat: HOME.lat,
				lon: HOME.lon,
				kind: 'move',
				from: '2026-06-20T08:00:00.000Z',
				to: '2026-06-20T08:00:00.000Z',
				samples: 1
			}
		]);
	});

	it('sorterer usorterte målinger før klyngning', () => {
		const result = clusterPositions([
			pos('2026-06-20T09:00:00Z', 59.97, 10.86),
			pos('2026-06-20T08:00:00Z', HOME.lat, HOME.lon),
			pos('2026-06-20T08:15:00Z', HOME.lat + 0.0001, HOME.lon)
		]);
		expect(result.map((n) => n.kind)).toEqual(['stop', 'move']);
		expect(result[0].from).toBe('2026-06-20T08:00:00.000Z');
		expect(result[0].to).toBe('2026-06-20T08:15:00.000Z');
	});

	it('ignorerer ugyldige koordinater og returnerer tom liste når alt mangler', () => {
		expect(clusterPositions([])).toEqual([]);
		expect(clusterPositions([pos('2026-06-20T08:00:00Z', NaN, 10.75)])).toEqual([]);
	});
});
