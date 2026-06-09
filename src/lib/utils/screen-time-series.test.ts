import { describe, it, expect } from 'vitest';
import {
	hourlyArrayFromBuckets,
	buildCumulativeWeekSeries,
	mondayOfWeekISO,
	previousWeekMondayISO,
	HOURS_PER_WEEK
} from './screen-time-series';

describe('hourlyArrayFromBuckets', () => {
	it('mapper buckets til 24-elements array', () => {
		const arr = hourlyArrayFromBuckets([
			{ hour: 7, totalMinutes: 12 },
			{ hour: 22, totalMinutes: 45 }
		]);
		expect(arr).toHaveLength(24);
		expect(arr![7]).toBe(12);
		expect(arr![22]).toBe(45);
		expect(arr![0]).toBe(0);
	});

	it('ignorerer ugyldige timer og negative verdier', () => {
		const arr = hourlyArrayFromBuckets([
			{ hour: -1, totalMinutes: 10 },
			{ hour: 24, totalMinutes: 10 },
			{ hour: 5, totalMinutes: -3 }
		]);
		expect(arr).toHaveLength(24);
		expect(arr![5]).toBe(0);
		expect(arr!.reduce((s, v) => s + v, 0)).toBe(0);
	});

	it('returnerer undefined for tom eller manglende input', () => {
		expect(hourlyArrayFromBuckets(undefined)).toBeUndefined();
		expect(hourlyArrayFromBuckets([])).toBeUndefined();
	});
});

describe('buildCumulativeWeekSeries', () => {
	const flatDay = (totalMinutes: number) => ({ totalMinutes });

	it('returnerer tom array når uka ikke har data', () => {
		expect(buildCumulativeWeekSeries([])).toEqual([]);
		expect(buildCumulativeWeekSeries([flatDay(0), flatDay(0)])).toEqual([]);
	});

	it('starter på 0 og ender på ukesummen', () => {
		const series = buildCumulativeWeekSeries([
			flatDay(120),
			flatDay(240),
			flatDay(60),
			flatDay(0),
			flatDay(90),
			flatDay(180),
			flatDay(30)
		]);
		expect(series).toHaveLength(HOURS_PER_WEEK + 1);
		expect(series[0]).toBe(0);
		expect(series[series.length - 1]).toBeCloseTo(120 + 240 + 60 + 90 + 180 + 30, 5);
	});

	it('er monotont voksende', () => {
		const series = buildCumulativeWeekSeries([flatDay(100), flatDay(50)]);
		for (let i = 1; i < series.length; i++) {
			expect(series[i]).toBeGreaterThanOrEqual(series[i - 1]);
		}
	});

	it('kuttes etter siste dag med data (pågående uke)', () => {
		const series = buildCumulativeWeekSeries([flatDay(120), flatDay(60), flatDay(0), flatDay(0)]);
		// To dager med data → 2 * 24 + startpunkt
		expect(series).toHaveLength(2 * 24 + 1);
		expect(series[series.length - 1]).toBeCloseTo(180, 5);
	});

	it('bruker time-detalj når den finnes, skalert til dagstotalen', () => {
		const hourly = new Array(24).fill(0);
		hourly[8] = 30;
		hourly[20] = 30; // timesum 60, men dagstotal 120 → skaleres x2
		const series = buildCumulativeWeekSeries([{ totalMinutes: 120, hourly }]);
		expect(series[8]).toBe(0); // før kl. 08 har ingenting skjedd
		expect(series[9]).toBeCloseTo(60, 5); // kl. 08-timen skalert til 60
		expect(series[24]).toBeCloseTo(120, 5);
	});

	it('fordeler dagstotal etter ukeprofil når time-detalj mangler', () => {
		const profile = new Array(24).fill(0);
		profile[12] = 100; // all aktivitet midt på dagen
		const series = buildCumulativeWeekSeries([flatDay(60)], profile);
		expect(series[12]).toBe(0);
		expect(series[13]).toBeCloseTo(60, 5);
		expect(series[24]).toBeCloseTo(60, 5);
	});

	it('fordeler flatt når verken time-detalj eller profil finnes', () => {
		const series = buildCumulativeWeekSeries([flatDay(24)]);
		expect(series[1]).toBeCloseTo(1, 5);
		expect(series[12]).toBeCloseTo(12, 5);
		expect(series[24]).toBeCloseTo(24, 5);
	});

	it('teller dag med kun time-detalj (uten total) som data', () => {
		const hourly = new Array(24).fill(0);
		hourly[10] = 15;
		const series = buildCumulativeWeekSeries([{ totalMinutes: 0, hourly }]);
		expect(series).toHaveLength(25);
		expect(series[24]).toBeCloseTo(15, 5);
	});
});

describe('mondayOfWeekISO', () => {
	it('snapper tirsdag til mandagen i samme uke', () => {
		expect(mondayOfWeekISO('2026-06-09')).toBe('2026-06-08');
	});

	it('lar mandag stå urørt', () => {
		expect(mondayOfWeekISO('2026-06-08')).toBe('2026-06-08');
	});

	it('snapper søndag tilbake til ukens mandag', () => {
		expect(mondayOfWeekISO('2026-06-14')).toBe('2026-06-08');
	});

	it('håndterer årsskifte', () => {
		// 1. jan 2026 er en torsdag → mandag 29. des 2025
		expect(mondayOfWeekISO('2026-01-01')).toBe('2025-12-29');
	});

	it('returnerer undefined for ugyldig dato', () => {
		expect(mondayOfWeekISO('ikke-en-dato')).toBeUndefined();
		expect(mondayOfWeekISO('')).toBeUndefined();
	});
});

describe('previousWeekMondayISO', () => {
	it('gir mandag i forrige ISO-uke', () => {
		// Tirsdag 9. juni 2026 → forrige mandag er 1. juni
		expect(previousWeekMondayISO(new Date(2026, 5, 9))).toBe('2026-06-01');
	});

	it('gir forrige mandag også når ref er en mandag', () => {
		expect(previousWeekMondayISO(new Date(2026, 5, 8))).toBe('2026-06-01');
	});
});
