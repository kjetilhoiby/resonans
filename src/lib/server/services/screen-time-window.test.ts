import { describe, it, expect } from 'vitest';
import { minutesInWindow, normalizeHourWindow, type HourBucket } from './screen-time-window';

function buckets(...pairs: Array<[hour: number, minutes: number]>): HourBucket[] {
	return pairs.map(([hour, totalMinutes]) => ({ hour, totalMinutes }));
}

describe('normalizeHourWindow', () => {
	it('godtar gyldig vindu 16–19', () => {
		expect(normalizeHourWindow(16, 19)).toEqual({ from: 16, to: 19 });
	});

	it('godtar vindu som slutter ved midnatt (22–24)', () => {
		expect(normalizeHourWindow(22, 24)).toEqual({ from: 22, to: 24 });
	});

	it('godtar vindu som krysser midnatt (22–6)', () => {
		expect(normalizeHourWindow(22, 6)).toEqual({ from: 22, to: 6 });
	});

	it('returnerer null når ett eller begge felt mangler', () => {
		expect(normalizeHourWindow(null, 19)).toBeNull();
		expect(normalizeHourWindow(16, null)).toBeNull();
		expect(normalizeHourWindow(undefined, undefined)).toBeNull();
	});

	it('avviser verdier utenfor gyldig område', () => {
		expect(normalizeHourWindow(-1, 19)).toBeNull();
		expect(normalizeHourWindow(24, 19)).toBeNull();
		expect(normalizeHourWindow(16, 0)).toBeNull();
		expect(normalizeHourWindow(16, 25)).toBeNull();
	});

	it('avviser ikke-heltall og tomt vindu', () => {
		expect(normalizeHourWindow(16.5, 19)).toBeNull();
		expect(normalizeHourWindow(16, 16)).toBeNull();
	});
});

describe('minutesInWindow', () => {
	const window16to19 = { from: 16, to: 19 };

	it('summerer kun timene innenfor vinduet', () => {
		const hourly = buckets([15, 10], [16, 20], [17, 30], [18, 15], [19, 40]);
		// 16 + 17 + 18 er med, 15 og 19 er utenfor ([from, to) er halvåpent)
		expect(minutesInWindow(hourly, window16to19)).toBe(65);
	});

	it('returnerer 0 når det finnes hourly-data men ingenting i vinduet', () => {
		const hourly = buckets([8, 45], [12, 30]);
		expect(minutesInWindow(hourly, window16to19)).toBe(0);
	});

	it('returnerer null når hourly-data mangler', () => {
		expect(minutesInWindow(null, window16to19)).toBeNull();
		expect(minutesInWindow(undefined, window16to19)).toBeNull();
		expect(minutesInWindow([], window16to19)).toBeNull();
	});

	it('håndterer vindu som krysser midnatt (22–6)', () => {
		const hourly = buckets([21, 10], [22, 20], [23, 30], [0, 5], [5, 15], [6, 60]);
		// 22, 23, 0 og 5 er med — 21 og 6 er utenfor
		expect(minutesInWindow(hourly, { from: 22, to: 6 })).toBe(70);
	});

	it('håndterer vindu som slutter ved midnatt (22–24)', () => {
		const hourly = buckets([21, 10], [22, 20], [23, 30]);
		expect(minutesInWindow(hourly, { from: 22, to: 24 })).toBe(50);
	});

	it('ignorerer ugyldige buckets uten å miste de gyldige', () => {
		const hourly = [
			{ hour: 16, totalMinutes: 20 },
			{ hour: 99, totalMinutes: 500 },
			{ hour: 17, totalMinutes: Number.NaN },
			{ hour: 18, totalMinutes: 10 }
		];
		expect(minutesInWindow(hourly, window16to19)).toBe(30);
	});

	it('returnerer null når alle buckets er ugyldige', () => {
		const hourly = [{ hour: 99, totalMinutes: 500 }];
		expect(minutesInWindow(hourly, window16to19)).toBeNull();
	});
});
