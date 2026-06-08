import { describe, it, expect } from 'vitest';
import { isoWeekKeyForDate, dayContextForDate, addDaysIso } from './iso-week';

describe('isoWeekKeyForDate', () => {
	it('mandag gir riktig uke', () => {
		expect(isoWeekKeyForDate('2026-04-20')).toBe('2026-W17');
	});

	it('søndag gir samme uke som mandagen', () => {
		expect(isoWeekKeyForDate('2026-04-26')).toBe('2026-W17');
	});

	it('1. januar som faller på torsdag → uke 1', () => {
		expect(isoWeekKeyForDate('2026-01-01')).toBe('2026-W01');
	});

	it('1. januar som faller på fredag → uke 53 av forrige år', () => {
		expect(isoWeekKeyForDate('2027-01-01')).toBe('2026-W53');
	});

	it('31. desember som faller i uke 1 neste år', () => {
		expect(isoWeekKeyForDate('2025-12-31')).toBe('2026-W01');
	});

	it('31. desember som hører til siste uke i eget år', () => {
		expect(isoWeekKeyForDate('2026-12-31')).toBe('2026-W53');
	});

	it('uke 1 edge case — mandag 29. desember 2025 er uke 1 i 2026', () => {
		expect(isoWeekKeyForDate('2025-12-29')).toBe('2026-W01');
	});

	it('uke 1 edge case — søndag 4. januar 2026 er uke 1 i 2026', () => {
		expect(isoWeekKeyForDate('2026-01-04')).toBe('2026-W01');
	});
});

describe('dayContextForDate', () => {
	it('setter sammen riktig format', () => {
		expect(dayContextForDate('2026-04-20')).toBe('week:2026-W17:day:2026-04-20');
	});

	it('bruker isoWeekKeyForDate for uke-delen', () => {
		expect(dayContextForDate('2025-12-31')).toBe('week:2026-W01:day:2025-12-31');
	});
});

describe('addDaysIso', () => {
	it('legger til positive dager', () => {
		expect(addDaysIso('2026-04-20', 3)).toBe('2026-04-23');
	});

	it('trekker fra med negative dager', () => {
		expect(addDaysIso('2026-04-20', -5)).toBe('2026-04-15');
	});

	it('krysser månedsgrense', () => {
		expect(addDaysIso('2026-01-30', 3)).toBe('2026-02-02');
	});

	it('krysser årsgrense', () => {
		expect(addDaysIso('2026-12-30', 5)).toBe('2027-01-04');
	});

	it('krysser årsgrense bakover', () => {
		expect(addDaysIso('2026-01-02', -5)).toBe('2025-12-28');
	});

	it('skuddår — legger til dag over 28. februar', () => {
		expect(addDaysIso('2024-02-28', 1)).toBe('2024-02-29');
	});

	it('ikke-skuddår — hopper over 29. februar', () => {
		expect(addDaysIso('2026-02-28', 1)).toBe('2026-03-01');
	});

	it('null dager gir samme dato', () => {
		expect(addDaysIso('2026-06-08', 0)).toBe('2026-06-08');
	});
});
