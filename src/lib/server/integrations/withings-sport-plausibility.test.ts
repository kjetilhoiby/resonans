import { describe, it, expect } from 'vitest';
import {
	getSportType,
	plausibleSportType,
	MIN_PLAUSIBLE_CYCLING_SPEED_MPS
} from './withings-sync';

describe('getSportType', () => {
	it('mapper e-sykkel-kategoriene til e_bike', () => {
		expect(getSportType(272)).toBe('e_bike');
		expect(getSportType(525)).toBe('e_bike');
	});

	it('mapper gange og sykkel', () => {
		expect(getSportType(1)).toBe('walking');
		expect(getSportType(6)).toBe('cycling');
	});
});

describe('plausibleSportType', () => {
	it('reklassifiserer en «el-sykkel» i gangtempo til gange (den ekte feilen)', () => {
		// IMG-caset: 4980 m på 1:15:11 (4511 s) ≈ 4 km/t — umulig for en el-sykkel.
		expect(plausibleSportType('e_bike', 4980, 4511)).toBe('walking');
	});

	it('reklassifiserer også vanlig sykkel i gangtempo (bratt gåtur, mye høydemeter)', () => {
		// 3 km med 700 hm: lav luftlinjefart selv om det var en real gåtur.
		expect(plausibleSportType('cycling', 3000, 3600)).toBe('walking');
	});

	it('lar en troverdig el-sykkeltur stå urørt', () => {
		// 20 km på 1 t = 20 km/t.
		expect(plausibleSportType('e_bike', 20000, 3600)).toBe('e_bike');
	});

	it('lar en troverdig sykkeltur stå urørt', () => {
		expect(plausibleSportType('cycling', 15000, 3600)).toBe('cycling');
	});

	it('rører aldri ikke-sykkel-sporter, selv i lav fart', () => {
		expect(plausibleSportType('walking', 3000, 3600)).toBe('walking');
		expect(plausibleSportType('running', 3000, 3600)).toBe('running');
		expect(plausibleSportType('hiking', 2000, 4000)).toBe('hiking');
	});

	it('lar sporten stå når grunnlaget mangler (for kort distanse eller ingen varighet)', () => {
		expect(plausibleSportType('e_bike', 300, 3600)).toBe('e_bike'); // < 500 m
		expect(plausibleSportType('e_bike', null, 3600)).toBe('e_bike');
		expect(plausibleSportType('e_bike', 4980, 0)).toBe('e_bike');
		expect(plausibleSportType('e_bike', 4980, null)).toBe('e_bike');
	});

	it('bruker ~7 km/t som terskel (rett under er gange, rett over er sykkel)', () => {
		const oneHour = 3600;
		const justBelow = (MIN_PLAUSIBLE_CYCLING_SPEED_MPS - 0.05) * oneHour;
		const justAbove = (MIN_PLAUSIBLE_CYCLING_SPEED_MPS + 0.05) * oneHour;
		expect(plausibleSportType('e_bike', justBelow, oneHour)).toBe('walking');
		expect(plausibleSportType('e_bike', justAbove, oneHour)).toBe('e_bike');
	});
});
