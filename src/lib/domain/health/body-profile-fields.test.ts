import { describe, it, expect } from 'vitest';
import {
	ageFromBirthYear,
	birthYearFromDate,
	isPlausibleBirthYear,
	missingProfileFields,
	validateDeskJobFactor,
	validateHeightCm,
	DESK_FACTOR_MAX,
	HEIGHT_MAX_CM,
	HEIGHT_MIN_CM
} from './body-profile-fields';

/** Fast «nå» i testene — ellers bytter forventningene ved nyttår. */
const NOW = new Date('2026-08-04T00:00:00Z');

describe('birthYearFromDate', () => {
	it('plukker året ut av en ISO-dato', () => {
		expect(birthYearFromDate('1984-03-17', NOW)).toBe(1984);
	});

	it('gir null på tull framfor et alderstall', () => {
		expect(birthYearFromDate(null, NOW)).toBeNull();
		expect(birthYearFromDate('', NOW)).toBeNull();
		expect(birthYearFromDate('1984', NOW)).toBeNull();
		expect(birthYearFromDate('17.03.1984', NOW)).toBeNull();
		expect(birthYearFromDate(undefined, NOW)).toBeNull();
	});

	it('avviser urimelige år', () => {
		// Et år utenfor 10–110 er en skrivefeil, ikke en alder.
		expect(birthYearFromDate('1850-01-01', NOW)).toBeNull();
		expect(birthYearFromDate('2025-01-01', NOW)).toBeNull();
	});

	it('godtar grensene', () => {
		expect(birthYearFromDate('1916-01-01', NOW)).toBe(1916);
		expect(birthYearFromDate('2016-01-01', NOW)).toBe(2016);
	});
});

describe('isPlausibleBirthYear', () => {
	it('krever et heltall', () => {
		expect(isPlausibleBirthYear(1984.5, NOW)).toBe(false);
		expect(isPlausibleBirthYear('1984', NOW)).toBe(false);
		expect(isPlausibleBirthYear(null, NOW)).toBe(false);
		expect(isPlausibleBirthYear(1984, NOW)).toBe(true);
	});
});

describe('ageFromBirthYear', () => {
	it('regner alder i hele år', () => {
		expect(ageFromBirthYear(1984, NOW)).toBe(42);
	});

	it('gir null uten år', () => {
		expect(ageFromBirthYear(null, NOW)).toBeNull();
	});
});

describe('missingProfileFields', () => {
	it('lister feltene i den rekkefølgen flaten spør om dem', () => {
		expect(missingProfileFields({ heightCm: null, sex: null, birthYear: null })).toEqual([
			'høyde',
			'kjønn',
			'fødselsår',
			'vekt'
		]);
	});

	it('skiller vekt fra de andre — den kan ikke skrives inn', () => {
		const fields = { heightCm: 187, sex: 'male' as const, birthYear: 1984 };
		expect(missingProfileFields(fields, { weightKg: 82 })).toEqual([]);
		expect(missingProfileFields(fields, { weightKg: null })).toEqual(['vekt']);
		expect(missingProfileFields(fields)).toEqual(['vekt']);
	});
});

describe('validateHeightCm', () => {
	it('godtar en menneskelig høyde', () => {
		expect(validateHeightCm(187)).toBeNull();
		expect(validateHeightCm(HEIGHT_MIN_CM)).toBeNull();
		expect(validateHeightCm(HEIGHT_MAX_CM)).toBeNull();
	});

	it('avviser meter framfor centimeter', () => {
		// 1,87 er den sannsynlige skrivefeilen, og den skal ikke bli 1,87 cm.
		expect(validateHeightCm(1.87)).toMatch(/mellom 120 og 230/);
	});

	it('avviser ikke-tall', () => {
		expect(validateHeightCm('187')).toBe('Høyde må være et tall.');
		expect(validateHeightCm(Number.NaN)).toBe('Høyde må være et tall.');
	});
});

describe('validateDeskJobFactor', () => {
	it('godtar spennet og avviser utenfor', () => {
		expect(validateDeskJobFactor(1.25)).toBeNull();
		expect(validateDeskJobFactor(DESK_FACTOR_MAX)).toBeNull();
		expect(validateDeskJobFactor(2.1)).toMatch(/mellom 1,1 og 1,9/);
		expect(validateDeskJobFactor(1)).toMatch(/mellom 1,1 og 1,9/);
	});

	it('skriver desimaltall med komma i feilmeldingen', () => {
		expect(validateDeskJobFactor(5)).toBe('Aktivitetsfaktoren må være mellom 1,1 og 1,9.');
	});
});
