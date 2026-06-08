import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateWeeks, generateMonths, generateYears, generateDays, getCurrentWeek, getCurrentMonth, getCurrentYear, getWeeksSince, getMonthsSince } from './time-periods';

describe('generateWeeks', () => {
	it('returnerer uker i synkende rekkefølge (nyeste først)', () => {
		const weeks = generateWeeks(2025);
		expect(weeks.length).toBeGreaterThan(0);
		expect(new Date(weeks[0].startDate).getTime()).toBeGreaterThan(new Date(weeks[1].startDate).getTime());
	});

	it('hver uke har 7 datoer', () => {
		const weeks = generateWeeks(2025);
		for (const week of weeks.slice(0, 5)) {
			expect(week.dates).toHaveLength(7);
		}
	});

	it('startTime er en mandag', () => {
		const weeks = generateWeeks(2025);
		for (const week of weeks.slice(0, 5)) {
			expect(week.startTime.getDay()).toBe(1);
		}
	});

	it('yearweek-format er korrekt', () => {
		const weeks = generateWeeks(2025);
		for (const week of weeks.slice(0, 5)) {
			expect(week.yearweek).toMatch(/^\d{4}W\d{2}$/);
		}
	});

	it('inkluderer ikke uker i fremtiden', () => {
		const weeks = generateWeeks(2025);
		const now = Date.now();
		for (const week of weeks) {
			expect(week.startTime.getTime()).toBeLessThanOrEqual(now);
		}
	});

	it('bruker startYear-parameter', () => {
		const from2024 = generateWeeks(2024);
		const from2025 = generateWeeks(2025);
		expect(from2024.length).toBeGreaterThan(from2025.length);
	});
});

describe('generateMonths', () => {
	it('returnerer måneder i synkende rekkefølge', () => {
		const months = generateMonths(2025);
		expect(months.length).toBeGreaterThan(0);
		expect(months[0].month).toBeGreaterThanOrEqual(months[1]?.month || 0);
	});

	it('yearmonth-format er korrekt', () => {
		const months = generateMonths(2025);
		for (const m of months.slice(0, 3)) {
			expect(m.yearmonth).toMatch(/^\d{4}M\d{2}$/);
		}
	});

	it('startTime er den 1. i måneden', () => {
		const months = generateMonths(2025);
		for (const m of months.slice(0, 3)) {
			expect(m.startTime.getDate()).toBe(1);
		}
	});
});

describe('generateYears', () => {
	it('returnerer år i synkende rekkefølge', () => {
		const years = generateYears(2020);
		expect(years[0].year).toBeGreaterThan(years[1].year);
	});

	it('startDate er 1. januar', () => {
		const years = generateYears(2020);
		for (const y of years) {
			expect(y.startDate).toBe(`${y.year}-01-01`);
		}
	});

	it('endDate er 31. desember', () => {
		const years = generateYears(2020);
		for (const y of years) {
			expect(y.endDate).toBe(`${y.year}-12-31`);
		}
	});
});

describe('generateDays', () => {
	it('returnerer korrekt antall dager', () => {
		const days = generateDays(7);
		expect(days).toHaveLength(7);
	});

	it('nyeste dag først', () => {
		const days = generateDays(7);
		expect(new Date(days[0].startDate).getTime()).toBeGreaterThan(new Date(days[1].startDate).getTime());
	});

	it('periodKey matcher startDate', () => {
		const days = generateDays(3);
		for (const d of days) {
			expect(d.periodKey).toBe(d.startDate);
		}
	});

	it('endDate er lik startDate (enkel dag)', () => {
		const days = generateDays(3);
		for (const d of days) {
			expect(d.endDate).toBe(d.startDate);
		}
	});

	it('default er 400 dager', () => {
		const days = generateDays();
		expect(days).toHaveLength(400);
	});
});

describe('getCurrentWeek', () => {
	it('returnerer en uke med korrekte felter', () => {
		const week = getCurrentWeek();
		expect(week).toHaveProperty('yearweek');
		expect(week).toHaveProperty('startDate');
		expect(week).toHaveProperty('dates');
		expect(week.dates).toHaveLength(7);
	});

	it('er den nyeste uken', () => {
		const week = getCurrentWeek();
		const all = generateWeeks();
		expect(week.yearweek).toBe(all[0].yearweek);
	});
});

describe('getCurrentMonth', () => {
	it('returnerer inneværende måned', () => {
		const month = getCurrentMonth();
		const now = new Date();
		expect(month.year).toBe(now.getFullYear());
		expect(month.month).toBe(now.getMonth() + 1);
	});
});

describe('getCurrentYear', () => {
	it('returnerer inneværende år', () => {
		const year = getCurrentYear();
		expect(year.year).toBe(new Date().getFullYear());
	});
});

describe('getWeeksSince', () => {
	it('filtrerer uker som overlapper med gitt dato', () => {
		const fourWeeksAgo = new Date(Date.now() - 28 * 86400000);
		const weeks = getWeeksSince(fourWeeksAgo);
		expect(weeks.length).toBeGreaterThanOrEqual(4);
		expect(weeks.length).toBeLessThanOrEqual(6);
	});

	it('returnerer alle uker for gammel dato', () => {
		const allWeeks = generateWeeks();
		const veryOld = new Date(2017, 0, 1);
		const since = getWeeksSince(veryOld);
		expect(since.length).toBe(allWeeks.length);
	});
});

describe('getMonthsSince', () => {
	it('filtrerer måneder som overlapper med gitt dato', () => {
		const threeMonthsAgo = new Date();
		threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
		const months = getMonthsSince(threeMonthsAgo);
		expect(months.length).toBeGreaterThanOrEqual(3);
		expect(months.length).toBeLessThanOrEqual(5);
	});
});
