import { describe, it, expect } from 'vitest';
import { WEEKDAY_INITIALS, monthKey, monthTitle, addMonths, monthGrid } from './month-grid';

describe('monthKey', () => {
	it('gir nullpolstret YYYY-MM', () => {
		expect(monthKey(new Date(2026, 0, 15))).toBe('2026-01');
		expect(monthKey(new Date(2026, 11, 1))).toBe('2026-12');
	});
});

describe('monthTitle', () => {
	it('gir norsk månedsnavn med stor forbokstav og år', () => {
		expect(monthTitle('2026-07')).toBe('Juli 2026');
		expect(monthTitle('2026-03')).toBe('Mars 2026');
	});

	it('gir tom streng for ugyldig nøkkel', () => {
		expect(monthTitle('tull')).toBe('');
		expect(monthTitle('2026-13')).toBe('');
	});
});

describe('addMonths', () => {
	it('desember → januar bytter år', () => {
		expect(addMonths('2026-12', 1)).toBe('2027-01');
		expect(addMonths('2026-01', -1)).toBe('2025-12');
	});

	it('flytter flere måneder', () => {
		expect(addMonths('2026-07', -7)).toBe('2025-12');
	});
});

describe('monthGrid', () => {
	it('starter uken på mandag', () => {
		expect(WEEKDAY_INITIALS).toEqual(['M', 'T', 'O', 'T', 'F', 'L', 'S']);
		// 1. juli 2026 er en onsdag → to tomme celler først (man, tir)
		const grid = monthGrid('2026-07');
		expect(grid[0]).toEqual([null, null, '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05']);
	});

	it('fyller siste uke med null og dekker alle dager', () => {
		const grid = monthGrid('2026-07');
		const days = grid.flat().filter(Boolean);
		expect(days).toHaveLength(31);
		expect(days.at(-1)).toBe('2026-07-31');
		expect(grid.every((week) => week.length === 7)).toBe(true);
	});

	it('skuddår februar har 29 dager', () => {
		const days = monthGrid('2028-02').flat().filter(Boolean);
		expect(days).toHaveLength(29);
		expect(days.at(-1)).toBe('2028-02-29');
	});

	it('gir tomt grid for ugyldig nøkkel', () => {
		expect(monthGrid('ugyldig')).toEqual([]);
	});
});
