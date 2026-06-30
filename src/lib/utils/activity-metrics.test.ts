import { describe, it, expect } from 'vitest';
import {
	isWheeledSport,
	speedKmh,
	formatPace,
	formatSpeed,
	formatPaceOrSpeed,
	paceOrSpeedLabel,
	formatSpeedDelta
} from './activity-metrics';

describe('isWheeledSport', () => {
	it('er sann for sykkel og elsykkel-varianter', () => {
		expect(isWheeledSport('cycling')).toBe(true);
		expect(isWheeledSport('e_bike')).toBe(true);
		expect(isWheeledSport('Elsykkel')).toBe(true);
		expect(isWheeledSport('eBiking')).toBe(true);
		expect(isWheeledSport('E-Bike')).toBe(true);
	});

	it('er usann for løping, gåing og tomme verdier', () => {
		expect(isWheeledSport('running')).toBe(false);
		expect(isWheeledSport('walking')).toBe(false);
		expect(isWheeledSport('')).toBe(false);
		expect(isWheeledSport(null)).toBe(false);
		expect(isWheeledSport(undefined)).toBe(false);
	});
});

describe('speedKmh', () => {
	it('konverterer tempo til fart', () => {
		expect(speedKmh(200)).toBe(18); // 200 s/km -> 18 km/t
		expect(speedKmh(120)).toBe(30);
	});

	it('returnerer null for ugyldige verdier', () => {
		expect(speedKmh(0)).toBeNull();
		expect(speedKmh(-5)).toBeNull();
		expect(speedKmh(null)).toBeNull();
		expect(speedKmh(undefined)).toBeNull();
	});
});

describe('formatPace', () => {
	it('formaterer sekunder-per-km som m:ss /km', () => {
		expect(formatPace(199)).toBe('3:19 /km');
		expect(formatPace(160)).toBe('2:40 /km');
	});

	it('støtter egendefinert suffiks', () => {
		expect(formatPace(160, '/km')).toBe('2:40/km');
		expect(formatPace(160, '')).toBe('2:40');
	});

	it('returnerer tom streng for ugyldige verdier', () => {
		expect(formatPace(0)).toBe('');
		expect(formatPace(null)).toBe('');
	});
});

describe('formatSpeed', () => {
	it('formaterer sekunder-per-km som km/t med én desimal', () => {
		expect(formatSpeed(200)).toBe('18.0 km/t');
		expect(formatSpeed(160)).toBe('22.5 km/t');
	});

	it('returnerer tom streng for ugyldige verdier', () => {
		expect(formatSpeed(0)).toBe('');
		expect(formatSpeed(null)).toBe('');
	});
});

describe('formatPaceOrSpeed', () => {
	it('viser fart for hjul-idretter', () => {
		expect(formatPaceOrSpeed('e_bike', 160)).toBe('22.5 km/t');
		expect(formatPaceOrSpeed('cycling', 200)).toBe('18.0 km/t');
	});

	it('viser tempo for øvrige idretter', () => {
		expect(formatPaceOrSpeed('running', 199)).toBe('3:19 /km');
	});
});

describe('paceOrSpeedLabel', () => {
	it('gir riktig etikett per idrett', () => {
		expect(paceOrSpeedLabel('e_bike')).toBe('Fart');
		expect(paceOrSpeedLabel('cycling')).toBe('Fart');
		expect(paceOrSpeedLabel('running')).toBe('Tempo');
	});
});

describe('formatSpeedDelta', () => {
	it('merker raskere (positivt) med pluss', () => {
		expect(formatSpeedDelta(3.2)).toBe('+3.2');
		expect(formatSpeedDelta(0)).toBe('+0.0');
	});

	it('merker tregere (negativt) med minustegn', () => {
		expect(formatSpeedDelta(-1.8)).toBe('−1.8');
	});
});
