import { describe, it, expect } from 'vitest';
import { buildDayPins, buildStoryPath, partialPath, cumulativeFractions } from './trip-map-story';
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
				images: [{ url: 'a.jpg', caption: 'Bading' }, { url: 'b.jpg' }],
				weather: { emoji: '☀️', temp: 27 }
			}
		];
		const pin = buildDayPins(entries, {})[0];
		expect(pin.images).toEqual([{ url: 'a.jpg', caption: 'Bading' }, { url: 'b.jpg' }]);
		expect(pin.weatherEmoji).toBe('☀️');
		expect(pin.weatherTemp).toBe(27);
	});
});

describe('buildStoryPath', () => {
	const pins = (
		...days: Array<[string, number, number]>
	): ReturnType<typeof buildDayPins> =>
		days.map(([date, lat, lon]) => ({ date, lat, lon, content: '', images: [] }));

	it('uten kjørespor er ruten luftlinje mellom dagpunktene', () => {
		const path = buildStoryPath(pins(['2026-07-01', 0, 0], ['2026-07-02', 0, 10], ['2026-07-03', 10, 10]));
		expect(path.coords).toEqual([
			[0, 0],
			[10, 0],
			[10, 10]
		]);
		expect(path.pinIndices).toEqual([0, 1, 2]);
		expect(path.pinFractions).toEqual([0, 0.5, 1]);
	});

	it('fletter inn kjørespor mellom to dagpunkter', () => {
		const path = buildStoryPath(pins(['2026-07-01', 0, 0], ['2026-07-02', 0, 10]), {
			'2026-07-02': [
				[2, 1],
				[6, 1]
			]
		});
		expect(path.coords).toEqual([
			[0, 0],
			[2, 1],
			[6, 1],
			[10, 0]
		]);
		expect(path.pinIndices).toEqual([0, 3]);
		expect(path.pinFractions).toEqual([0, 1]);
	});

	it('bruker hvert dags-spor bare én gang selv om datoen treffer to segmenter', () => {
		// Sporet for 07-02 kvalifiserer både for segmentet 01→02 og 02→03; det
		// skal bare flettes inn i det første.
		const path = buildStoryPath(
			pins(['2026-07-01', 0, 0], ['2026-07-02', 0, 10], ['2026-07-03', 0, 20]),
			{ '2026-07-02': [[5, 1]] }
		);
		expect(path.coords).toEqual([
			[0, 0],
			[5, 1],
			[10, 0],
			[20, 0]
		]);
	});

	it('fletter spor for mellomliggende dager uten eget dagpunkt', () => {
		const path = buildStoryPath(pins(['2026-07-01', 0, 0], ['2026-07-04', 0, 30]), {
			'2026-07-02': [[10, 0]],
			'2026-07-03': [[20, 0]]
		});
		expect(path.coords).toEqual([
			[0, 0],
			[10, 0],
			[20, 0],
			[30, 0]
		]);
	});

	it('ignorerer spor utenfor dagpunkt-vinduet', () => {
		const path = buildStoryPath(pins(['2026-07-02', 0, 0], ['2026-07-03', 0, 10]), {
			'2026-07-01': [[99, 99]],
			'2026-07-05': [[99, 99]]
		});
		expect(path.coords).toEqual([
			[0, 0],
			[10, 0]
		]);
	});

	it('klarer degenererte input', () => {
		expect(buildStoryPath([])).toEqual({ coords: [], pinIndices: [], pinFractions: [] });
		const single = buildStoryPath(pins(['2026-07-01', 1, 2]));
		expect(single.coords).toEqual([[2, 1]]);
		expect(single.pinFractions).toEqual([0]);
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

describe('cumulativeFractions', () => {
	it('gir andel tilbakelagt ved hvert punkt, fra 0 til 1', () => {
		const coords: Array<[number, number]> = [
			[0, 0],
			[10, 0],
			[10, 10]
		];
		// Segmentene er like lange (10 + 10) → 0, 0.5, 1
		expect(cumulativeFractions(coords)).toEqual([0, 0.5, 1]);
	});

	it('vekter etter faktisk segmentlengde', () => {
		const coords: Array<[number, number]> = [
			[0, 0],
			[30, 0],
			[40, 0]
		];
		// Lengder 30 + 10 = 40 → 0, 0.75, 1
		expect(cumulativeFractions(coords)).toEqual([0, 0.75, 1]);
	});

	it('fordeler jevnt når alle punktene er like', () => {
		const coords: Array<[number, number]> = [
			[5, 5],
			[5, 5],
			[5, 5]
		];
		expect(cumulativeFractions(coords)).toEqual([0, 0.5, 1]);
	});

	it('klarer degenererte input', () => {
		expect(cumulativeFractions([])).toEqual([]);
		expect(cumulativeFractions([[1, 1]])).toEqual([0]);
	});
});
