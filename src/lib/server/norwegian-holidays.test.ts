import { describe, it, expect } from 'vitest';
import { isNonWorkingIsoDay, isNonWorkingDay, isNorwegianHoliday, isWeekend } from './norwegian-holidays';

describe('isNorwegianHoliday', () => {
	it('kjenner igjen 17. mai og 1. nyttårsdag', () => {
		expect(isNorwegianHoliday(new Date(2026, 4, 17, 12))).toBe(true);
		expect(isNorwegianHoliday(new Date(2026, 0, 1, 12))).toBe(true);
	});
	it('avviser en vanlig hverdag', () => {
		expect(isNorwegianHoliday(new Date(2026, 5, 9, 12))).toBe(false); // tirsdag
	});
});

describe('isWeekend / isNonWorkingDay', () => {
	it('helg er fridag', () => {
		expect(isWeekend(new Date(2026, 5, 13, 12))).toBe(true); // lørdag
		expect(isNonWorkingDay(new Date(2026, 5, 13, 12))).toBe(true);
	});
	it('helligdag på hverdag er fridag', () => {
		expect(isNonWorkingDay(new Date(2026, 4, 17, 12))).toBe(true); // 17. mai
	});
	it('vanlig tirsdag er arbeidsdag', () => {
		expect(isNonWorkingDay(new Date(2026, 5, 9, 12))).toBe(false);
	});
});

describe('isNonWorkingIsoDay', () => {
	it('tolker ISO-dato lokalt', () => {
		expect(isNonWorkingIsoDay('2026-06-13')).toBe(true); // lørdag
		expect(isNonWorkingIsoDay('2026-05-17')).toBe(true); // 17. mai
		expect(isNonWorkingIsoDay('2026-06-09')).toBe(false); // tirsdag
	});
	it('avviser ugyldig format', () => {
		expect(isNonWorkingIsoDay('ikke-en-dato')).toBe(false);
		expect(isNonWorkingIsoDay('')).toBe(false);
	});
});
