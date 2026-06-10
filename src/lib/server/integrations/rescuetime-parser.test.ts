import { describe, it, expect } from 'vitest';
import { parseRescueTimeRows } from './rescuetime-parser';
import type { RescueTimeApiRow } from './rescuetime-parser';

function row(
	date: string,
	seconds: number,
	activity: string,
	category: string,
	productivity: number
): RescueTimeApiRow {
	return [date, seconds, 1, activity, category, productivity];
}

describe('parseRescueTimeRows', () => {
	it('gir tom liste for tomt svar', () => {
		expect(parseRescueTimeRows([])).toEqual([]);
	});

	it('grupperer rader per dag og summerer totaler', () => {
		const days = parseRescueTimeRows([
			row('2026-06-09T09:00:00', 1800, 'VS Code', 'Editing & IDEs', 2),
			row('2026-06-09T10:00:00', 1200, 'Slack', 'Instant Message', -1),
			row('2026-06-10T09:00:00', 600, 'VS Code', 'Editing & IDEs', 2)
		]);
		expect(days).toHaveLength(2);
		expect(days[0].dateISO).toBe('2026-06-09');
		expect(days[0].totalSeconds).toBe(3000);
		expect(days[0].productiveSeconds).toBe(1800);
		expect(days[0].distractingSeconds).toBe(1200);
		expect(days[1].dateISO).toBe('2026-06-10');
	});

	it('summerer kategorier på tvers av aktiviteter, sortert etter tid', () => {
		const days = parseRescueTimeRows([
			row('2026-06-09T09:00:00', 600, 'VS Code', 'Editing & IDEs', 2),
			row('2026-06-09T10:00:00', 900, 'IntelliJ', 'Editing & IDEs', 2),
			row('2026-06-09T10:00:00', 300, 'YouTube', 'Video', -2)
		]);
		expect(days[0].byCategory).toEqual([
			{ category: 'Editing & IDEs', seconds: 1500 },
			{ category: 'Video', seconds: 300 }
		]);
	});

	it('regner kveld som timer fra og med 17', () => {
		const days = parseRescueTimeRows([
			row('2026-06-09T16:00:00', 1000, 'VS Code', 'Editing & IDEs', 2),
			row('2026-06-09T17:00:00', 800, 'VS Code', 'Editing & IDEs', 2),
			row('2026-06-09T21:00:00', 400, 'YouTube', 'Video', -2)
		]);
		expect(days[0].evening.seconds).toBe(1200);
		expect(days[0].evening.productiveSeconds).toBe(800);
		expect(days[0].evening.byCategory).toEqual([
			{ category: 'Editing & IDEs', seconds: 800 },
			{ category: 'Video', seconds: 400 }
		]);
	});

	it('bygger timefordeling med produktiv andel', () => {
		const days = parseRescueTimeRows([
			row('2026-06-09T09:00:00', 600, 'VS Code', 'Editing & IDEs', 2),
			row('2026-06-09T09:00:00', 300, 'YouTube', 'Video', -2),
			row('2026-06-09T20:00:00', 100, 'Mail', 'Email', 1)
		]);
		expect(days[0].hourly).toEqual([
			{ hour: 9, seconds: 900, productiveSeconds: 600 },
			{ hour: 20, seconds: 100, productiveSeconds: 100 }
		]);
	});

	it('slår sammen samme aktivitet over flere timer i topplisten', () => {
		const days = parseRescueTimeRows([
			row('2026-06-09T09:00:00', 600, 'VS Code', 'Editing & IDEs', 2),
			row('2026-06-09T14:00:00', 900, 'VS Code', 'Editing & IDEs', 2),
			row('2026-06-09T15:00:00', 200, 'Slack', 'Instant Message', -1)
		]);
		expect(days[0].topActivities[0]).toEqual({
			activity: 'VS Code',
			category: 'Editing & IDEs',
			seconds: 1500
		});
		expect(days[0].topActivities).toHaveLength(2);
	});

	it('hopper over rader med ugyldig dato eller ikke-positiv tid', () => {
		const days = parseRescueTimeRows([
			row('', 600, 'VS Code', 'Editing & IDEs', 2),
			row('2026-06-09T09:00:00', 0, 'VS Code', 'Editing & IDEs', 2),
			row('2026-06-09T09:00:00', 300, 'Slack', 'Instant Message', -1)
		]);
		expect(days).toHaveLength(1);
		expect(days[0].totalSeconds).toBe(300);
	});
});
