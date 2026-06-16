import { describe, expect, it } from 'vitest';
import { calculateAge, daysUntilBirthday } from './family-tree';

describe('daysUntilBirthday', () => {
	it('er 0 på selve bursdagen — uavhengig av klokkeslett', () => {
		// Tidligere bug: midnatt < «nå» rullet bursdagen et helt år frem (364)
		expect(daysUntilBirthday('1982-06-16', new Date('2026-06-16T05:24:00Z'))).toBe(0);
		expect(daysUntilBirthday('1982-06-16', new Date('2026-06-16T23:59:00Z'))).toBe(0);
	});

	it('teller hele dager frem til neste bursdag', () => {
		expect(daysUntilBirthday('1982-06-18', new Date('2026-06-16T08:00:00Z'))).toBe(2);
		expect(daysUntilBirthday('1982-06-17', new Date('2026-06-16T20:00:00Z'))).toBe(1);
	});

	it('ruller til neste år når bursdagen er passert', () => {
		expect(daysUntilBirthday('1982-06-16', new Date('2026-06-17T08:00:00Z'))).toBe(364);
	});

	it('er null uten fødselsdato', () => {
		expect(daysUntilBirthday(null, new Date('2026-06-16T08:00:00Z'))).toBeNull();
	});
});

describe('calculateAge', () => {
	it('regner alder på bursdagen', () => {
		expect(calculateAge('1982-06-16', new Date('2026-06-16T08:00:00Z'))).toBe(44);
	});

	it('teller ikke året før bursdagen er passert', () => {
		expect(calculateAge('1982-06-18', new Date('2026-06-16T08:00:00Z'))).toBe(43);
	});
});
