import { describe, it, expect } from 'vitest';
import { buildStreakCalendar, countByDay, firstMonthWithEvents } from './streak-history';

describe('countByDay', () => {
	it('teller duplikater — to løpeturer samme dag er to hendelser', () => {
		expect(countByDay(['2026-08-01', '2026-08-01', '2026-08-03'])).toEqual([
			{ date: '2026-08-01', count: 2 },
			{ date: '2026-08-03', count: 1 }
		]);
	});

	it('sorterer stigende', () => {
		expect(countByDay(['2026-08-05', '2026-07-31']).map((d) => d.date)).toEqual([
			'2026-07-31',
			'2026-08-05'
		]);
	});
});

describe('buildStreakCalendar', () => {
	const days = countByDay(['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-05', '2026-08-10']);

	it('legger dagene i mandag-ankrede rader', () => {
		const month = buildStreakCalendar({
			month: '2026-08',
			days,
			todayKey: '2026-08-23',
			rule: 'consecutive_days',
			config: {}
		});

		// August 2026 starter på en lørdag: første rad har fem tomme celler.
		expect(month.rows[0].cells.slice(0, 5).every((c) => c === null)).toBe(true);
		expect(month.rows[0].cells[5]?.date).toBe('2026-08-01');
		expect(month.title).toBe('August 2026');
	});

	it('bærer antallet per dag', () => {
		const month = buildStreakCalendar({
			month: '2026-08',
			days,
			todayKey: '2026-08-23',
			rule: 'consecutive_days',
			config: {}
		});
		const cells = month.rows.flatMap((r) => r.cells).filter((c) => c !== null);

		expect(cells.find((c) => c!.date === '2026-08-05')!.count).toBe(2);
		expect(cells.find((c) => c!.date === '2026-08-06')!.count).toBe(0);
	});

	it('markerer i dag og skiller framtida fra en glemt dag', () => {
		const month = buildStreakCalendar({
			month: '2026-08',
			days,
			todayKey: '2026-08-23',
			rule: 'consecutive_days',
			config: {}
		});
		const cells = month.rows.flatMap((r) => r.cells).filter((c) => c !== null);

		expect(cells.find((c) => c!.date === '2026-08-23')!.isToday).toBe(true);
		expect(cells.find((c) => c!.date === '2026-08-24')!.isFuture).toBe(true);
		expect(cells.find((c) => c!.date === '2026-08-22')!.isFuture).toBe(false);
	});

	it('teller dekning bare for dager som er gått', () => {
		const month = buildStreakCalendar({
			month: '2026-08',
			days,
			todayKey: '2026-08-10',
			rule: 'consecutive_days',
			config: {}
		});

		expect(month.daysElapsed).toBe(10);
		expect(month.daysWithEvent).toBe(4);
		// 2026-08-05 har to hendelser, så summen er høyere enn antall dager.
		expect(month.events).toBe(5);
	});

	it('gir hver rad periodens fasit for et ukesvindu', () => {
		const month = buildStreakCalendar({
			month: '2026-08',
			days,
			todayKey: '2026-08-23',
			rule: 'count_per_window',
			config: { windowDays: 7, threshold: 2 }
		});

		// Uka 3.–9. august har fire hendelser: terskelen er nådd.
		const week = month.rows.find((r) => r.cells.some((c) => c?.date === '2026-08-03'))!;
		expect(week.window).toEqual({ count: 4, target: 2, met: true });

		// Uka 10.–16. har én: ikke nådd.
		const next = month.rows.find((r) => r.cells.some((c) => c?.date === '2026-08-10'))!;
		expect(next.window).toEqual({ count: 1, target: 2, met: false });
	});

	it('regner periodens fasit på hele historikken, ikke bare på synlige dager', () => {
		// Uka 27. juli–2. august krysser månedsskiftet. Juli-hendelsene teller også
		// når man ser på august, ellers viser samme uke to ulike tall.
		const crossing = countByDay(['2026-07-28', '2026-07-30', '2026-08-01']);
		const august = buildStreakCalendar({
			month: '2026-08',
			days: crossing,
			todayKey: '2026-08-23',
			rule: 'count_per_window',
			config: { windowDays: 7, threshold: 2 }
		});
		const july = buildStreakCalendar({
			month: '2026-07',
			days: crossing,
			todayKey: '2026-08-23',
			rule: 'count_per_window',
			config: { windowDays: 7, threshold: 2 }
		});

		const augustWeek = august.rows.find((r) => r.cells.some((c) => c?.date === '2026-08-01'))!;
		const julyWeek = july.rows.find((r) => r.cells.some((c) => c?.date === '2026-07-28'))!;
		expect(augustWeek.window).toEqual({ count: 3, target: 2, met: true });
		expect(julyWeek.window).toEqual(augustWeek.window);
	});

	it('lar en periode som ikke har begynt være umerket', () => {
		const month = buildStreakCalendar({
			month: '2026-08',
			days,
			todayKey: '2026-08-10',
			rule: 'count_per_window',
			config: { windowDays: 7, threshold: 2 }
		});

		const future = month.rows.find((r) => r.cells.some((c) => c?.date === '2026-08-24'))!;
		expect(future.window).toBeNull();
	});

	it('viser ingen periodemarkør når vinduet ikke er en uke', () => {
		// Et 10-dagersvindu faller ikke sammen med kalenderrader, og en rad merket
		// «1 av 2» for en periode den bare dekker halve, er verre enn ingen merking.
		const month = buildStreakCalendar({
			month: '2026-08',
			days,
			todayKey: '2026-08-23',
			rule: 'count_per_window',
			config: { windowDays: 10, threshold: 2 }
		});

		expect(month.rows.every((r) => r.window === null)).toBe(true);
	});

	it('viser ingen periodemarkør for dager-på-rad og vedlikehold', () => {
		for (const rule of ['consecutive_days', 'max_interval'] as const) {
			const month = buildStreakCalendar({
				month: '2026-08',
				days,
				todayKey: '2026-08-23',
				rule,
				config: { intervalDays: 30 }
			});
			expect(month.rows.every((r) => r.window === null), rule).toBe(true);
		}
	});
});

describe('firstMonthWithEvents', () => {
	it('gir måneden til den eldste hendelsen', () => {
		expect(firstMonthWithEvents(countByDay(['2026-08-05', '2026-03-31']))).toBe('2026-03');
	});

	it('gir null uten hendelser', () => {
		expect(firstMonthWithEvents([])).toBeNull();
	});
});
