import { describe, it, expect } from 'vitest';
import { buildDayPins, partialPath } from './trip-map-story';
import type { DiaryEntry, DayGeo } from './trip-api';

describe('buildDayPins', () => {
	it('bruker notatets eget geokodede sted når det finnes', () => {
		const entries: DiaryEntry[] = [
			{ date: '2026-07-02', content: 'Strand', place: 'Nice', geo: { lat: 43.7, lon: 7.27 } }
		];
		const pins = buildDayPins(entries, {});
		expect(pins).toHaveLength(1);
		expect(pins[0]).toMatchObject({ date: '2026-07-02', lat: 43.7, lon: 7.27, place: 'Nice' });
	});

	it('faller tilbake til geoByDay når notatet mangler koordinat', () => {
		const entries: DiaryEntry[] = [{ date: '2026-07-01', content: 'Avreise' }];
		const geoByDay: Record<string, DayGeo> = {
			'2026-07-01': { lat: 59.9, lon: 10.7, place: 'Oslo', source: 'observed' }
		};
		const pins = buildDayPins(entries, geoByDay);
		expect(pins).toHaveLength(1);
		expect(pins[0]).toMatchObject({ lat: 59.9, lon: 10.7, place: 'Oslo' });
	});

	it('hopper over dager uten koordinat', () => {
		const entries: DiaryEntry[] = [{ date: '2026-07-01', content: 'Ingen sted' }];
		expect(buildDayPins(entries, {})).toHaveLength(0);
	});

	it('sorterer kronologisk uansett input-rekkefølge', () => {
		const entries: DiaryEntry[] = [
			{ date: '2026-07-03', content: 'C', geo: { lat: 3, lon: 3 } },
			{ date: '2026-07-01', content: 'A', geo: { lat: 1, lon: 1 } },
			{ date: '2026-07-02', content: 'B', geo: { lat: 2, lon: 2 } }
		];
		expect(buildDayPins(entries, {}).map((p) => p.date)).toEqual([
			'2026-07-01',
			'2026-07-02',
			'2026-07-03'
		]);
	});

	it('tar med bilder og vær', () => {
		const entries: DiaryEntry[] = [
			{
				date: '2026-07-01',
				content: 'Sol',
				geo: { lat: 1, lon: 1 },
				images: ['a.jpg', 'b.jpg'],
				weather: { emoji: '☀️', temp: 27 }
			}
		];
		const pin = buildDayPins(entries, {})[0];
		expect(pin.images).toEqual(['a.jpg', 'b.jpg']);
		expect(pin.weatherEmoji).toBe('☀️');
		expect(pin.weatherTemp).toBe(27);
	});
});

describe('partialPath', () => {
	const coords: Array<[number, number]> = [
		[0, 0],
		[10, 0],
		[10, 10]
	];

	it('returnerer bare startpunktet ved fraction 0', () => {
		expect(partialPath(coords, 0)).toEqual([[0, 0]]);
	});

	it('returnerer hele ruten ved fraction 1', () => {
		expect(partialPath(coords, 1)).toEqual(coords);
	});

	it('kutter på et interpolert punkt midtveis', () => {
		// Total lengde = 20; 50% = 10 → akkurat hjørnet [10,0]
		expect(partialPath(coords, 0.5)).toEqual([
			[0, 0],
			[10, 0]
		]);
	});

	it('interpolerer inni et segment', () => {
		// 75% av 20 = 15 → 5 inn i andre segment ([10,0]→[10,10])
		expect(partialPath(coords, 0.75)).toEqual([
			[0, 0],
			[10, 0],
			[10, 5]
		]);
	});

	it('klarer degenererte input', () => {
		expect(partialPath([[1, 1]], 0.5)).toEqual([[1, 1]]);
		expect(partialPath([], 0.5)).toEqual([]);
	});
});
