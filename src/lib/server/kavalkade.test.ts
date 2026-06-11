import { describe, expect, it } from 'vitest';
import {
	formatKavalkadeForPrompt,
	getBirthdayWindows,
	summarizeYear,
	type KavalkadeWindow
} from './kavalkade';

describe('getBirthdayWindows', () => {
	it('bruker kommende bursdag som vindusslutt når bursdagen er om en uke', () => {
		const windows = getBirthdayWindows('1982-06-18', new Date('2026-06-11T12:00:00Z'));
		expect(windows.nextBirthday).toEqual(new Date(2026, 5, 18));
		expect(windows.current.start).toEqual(new Date(2025, 5, 18));
		expect(windows.current.end).toEqual(new Date(2026, 5, 18));
		expect(windows.previous.start).toEqual(new Date(2024, 5, 18));
		expect(windows.previous.end).toEqual(new Date(2025, 5, 18));
	});

	it('ruller til neste år når årets bursdag er passert', () => {
		const windows = getBirthdayWindows('1982-06-18', new Date('2026-06-19T08:00:00Z'));
		expect(windows.nextBirthday).toEqual(new Date(2027, 5, 18));
		expect(windows.current.start).toEqual(new Date(2026, 5, 18));
	});

	it('regner bursdag i dag som kommende bursdag', () => {
		const windows = getBirthdayWindows('1982-06-18', new Date('2026-06-18T08:00:00Z'));
		expect(windows.nextBirthday).toEqual(new Date(2026, 5, 18));
	});

	it('faller tilbake til siste 365 dager uten fødselsdato', () => {
		const windows = getBirthdayWindows(null, new Date('2026-06-11T12:00:00Z'));
		expect(windows.nextBirthday).toBeNull();
		expect(windows.current.start).toEqual(new Date(2025, 5, 11));
		expect(windows.current.end).toEqual(new Date(2026, 5, 11));
	});
});

describe('summarizeYear', () => {
	const window: KavalkadeWindow = {
		start: new Date(2025, 5, 18),
		end: new Date(2026, 5, 18)
	};

	it('summerer treningsøkter per sport og filtrerer på vindu', () => {
		const summary = summarizeYear(window, {
			workoutDays: [
				{ date: new Date(2025, 7, 1), sportFamily: 'running', count: 2, distanceMeters: 15000, durationSeconds: 5400 },
				{ date: new Date(2026, 2, 10), sportFamily: 'running', count: 1, distanceMeters: 10000, durationSeconds: 3600 },
				{ date: new Date(2025, 8, 5), sportFamily: 'walking', count: 1, distanceMeters: 4000, durationSeconds: 3000 },
				// Utenfor vinduet — skal ikke telles
				{ date: new Date(2025, 4, 1), sportFamily: 'running', count: 5, distanceMeters: 50000, durationSeconds: 18000 }
			],
			months: [],
			books: []
		});
		expect(summary.workoutCount).toBe(4);
		expect(summary.sports).toEqual([
			{ family: 'running', count: 3, distanceKm: 25, durationHours: 2.5 },
			{ family: 'walking', count: 1, distanceKm: 4, durationHours: 0.8 }
		]);
	});

	it('beregner skritt, søvn, vektendring og skjermtid fra månedsaggregater', () => {
		const summary = summarizeYear(window, {
			workoutDays: [],
			months: [
				{
					startDate: new Date(2025, 6, 1),
					metrics: {
						steps: { sum: 200_000 },
						sleep: { avg: 7.2 },
						weight: { avg: 84.4 },
						screenTime: { avgPerDayMinutes: 190 }
					}
				},
				{
					startDate: new Date(2026, 4, 1),
					metrics: {
						steps: { sum: 250_000 },
						sleep: { avg: 6.8 },
						weight: { avg: 82.1 },
						screenTime: { avgPerDayMinutes: 150 }
					}
				},
				// Måned som starter utenfor vinduet ignoreres
				{ startDate: new Date(2025, 4, 1), metrics: { steps: { sum: 999_999 } } }
			],
			books: []
		});
		expect(summary.stepsTotal).toBe(450_000);
		expect(summary.sleepAvgHours).toBe(7);
		expect(summary.weightStartKg).toBe(84.4);
		expect(summary.weightEndKg).toBe(82.1);
		expect(summary.weightChangeKg).toBe(-2.3);
		expect(summary.screenTimeAvgMinPerDay).toBe(170);
	});

	it('gir null-verdier og tomme lister når data mangler', () => {
		const summary = summarizeYear(window, { workoutDays: [], months: [], books: [] });
		expect(summary.workoutCount).toBe(0);
		expect(summary.stepsTotal).toBeNull();
		expect(summary.sleepAvgHours).toBeNull();
		expect(summary.weightChangeKg).toBeNull();
		expect(summary.books).toEqual([]);
	});

	it('viser ikke vektendring basert på bare én måned', () => {
		const summary = summarizeYear(window, {
			workoutDays: [],
			months: [{ startDate: new Date(2025, 6, 1), metrics: { weight: { avg: 84 } } }],
			books: []
		});
		expect(summary.weightStartKg).toBe(84);
		expect(summary.weightChangeKg).toBeNull();
	});

	it('filtrerer og sorterer ferdigleste bøker kronologisk', () => {
		const summary = summarizeYear(window, {
			workoutDays: [],
			months: [],
			books: [
				{ title: 'Stoner', author: 'John Williams', finishedAt: new Date(2026, 1, 10) },
				{ title: 'Solaris', author: 'Stanisław Lem', finishedAt: new Date(2025, 8, 2) },
				{ title: 'Gammel bok', author: null, finishedAt: new Date(2024, 8, 2) }
			]
		});
		expect(summary.books).toEqual([
			{ title: 'Solaris', author: 'Stanisław Lem' },
			{ title: 'Stoner', author: 'John Williams' }
		]);
	});
});

describe('formatKavalkadeForPrompt', () => {
	it('lager kompakt norsk oppsummering av i år vs. i fjor', () => {
		const window: KavalkadeWindow = { start: new Date(2025, 5, 18), end: new Date(2026, 5, 18) };
		const current = summarizeYear(window, {
			workoutDays: [
				{ date: new Date(2025, 7, 1), sportFamily: 'running', count: 3, distanceMeters: 30000, durationSeconds: 10800 }
			],
			months: [
				{ startDate: new Date(2025, 6, 1), metrics: { steps: { sum: 100_000 }, weight: { avg: 84 }, sleep: { avg: 7 } } },
				{ startDate: new Date(2026, 0, 1), metrics: { steps: { sum: 120_000 }, weight: { avg: 82.5 }, sleep: { avg: 7 } } }
			],
			books: [{ title: 'Stoner', author: null, finishedAt: new Date(2026, 1, 1) }]
		});
		const previous = summarizeYear(window, { workoutDays: [], months: [], books: [] });
		const text = formatKavalkadeForPrompt(current, previous);
		expect(text).toContain('I år: 3 treningsøkter (løpt 30 km)');
		expect(text).toContain('I fjor: 0 treningsøkter');
		expect(text).toContain('Bøker lest i år: 1 (Stoner) — i fjor 0');
		expect(text).toContain('Vektendring i år: -1.5 kg');
	});
});
