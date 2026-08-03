import { describe, it, expect } from 'vitest';
import {
	buildSleepNightSeries,
	summarizeSleepRhythm,
	compositeSleepLag
} from './sleep-overview';
import type { SleepNight } from '$lib/domain/sleep-goals';

/** Natt fra `start` (ISO, UTC) med gitt varighet. */
function night(start: string, durationH: number, isNap = false): SleepNight {
	const s = new Date(start);
	return {
		start: s,
		end: new Date(s.getTime() + durationH * 3_600_000),
		durationH,
		isNap
	};
}

describe('buildSleepNightSeries', () => {
	it('daterer natten til morgenen man våkner, ikke kvelden man la seg', () => {
		// Legger seg 22:30 den 8., våkner 06:30 den 9. → natten hører til 9.
		const series = buildSleepNightSeries([night('2026-03-08T21:30:00Z', 8)]);
		expect(series[0].date).toBe('2026-03-09');
	});

	it('sorterer eldste først uansett inn-rekkefølge', () => {
		const series = buildSleepNightSeries([
			night('2026-03-10T22:00:00Z', 7),
			night('2026-03-08T22:00:00Z', 8),
			night('2026-03-09T22:00:00Z', 6)
		]);
		expect(series.map((p) => p.date)).toEqual(['2026-03-09', '2026-03-10', '2026-03-11']);
	});

	it('runder timer til to desimaler', () => {
		const series = buildSleepNightSeries([night('2026-03-08T22:00:00Z', 7.456)]);
		expect(series[0].hours).toBe(7.46);
	});

	it('merker naps, men beholder dem i serien', () => {
		const series = buildSleepNightSeries([
			night('2026-03-08T22:00:00Z', 8),
			night('2026-03-09T12:00:00Z', 0.5, true)
		]);
		expect(series).toHaveLength(2);
		expect(series.filter((p) => p.isNap)).toHaveLength(1);
	});

	it('takler tom liste', () => {
		expect(buildSleepNightSeries([])).toEqual([]);
	});
});

describe('summarizeSleepRhythm', () => {
	it('snitter bare ekte netter — naps skal ikke dra snittet ned', () => {
		const rhythm = summarizeSleepRhythm([
			night('2026-03-08T22:00:00Z', 8),
			night('2026-03-09T22:00:00Z', 6),
			night('2026-03-09T12:00:00Z', 0.5, true)
		]);
		expect(rhythm.avgHours).toBe(7);
		expect(rhythm.nightCount).toBe(2);
	});

	it('gir median leggetid og våkning som HH:MM', () => {
		const rhythm = summarizeSleepRhythm([
			night('2026-03-08T22:00:00Z', 8),
			night('2026-03-09T22:00:00Z', 8),
			night('2026-03-10T22:00:00Z', 8)
		]);
		expect(rhythm.bedtime).toMatch(/^\d{2}:\d{2}$/);
		expect(rhythm.wake).toMatch(/^\d{2}:\d{2}$/);
	});

	it('returnerer tom oppsummering når det bare finnes naps', () => {
		const rhythm = summarizeSleepRhythm([night('2026-03-09T12:00:00Z', 0.5, true)]);
		expect(rhythm).toEqual({ bedtime: null, wake: null, avgHours: null, nightCount: 0 });
	});

	it('returnerer tom oppsummering uten netter', () => {
		expect(summarizeSleepRhythm([])).toEqual({
			bedtime: null,
			wake: null,
			avgHours: null,
			nightCount: 0
		});
	});
});

describe('compositeSleepLag', () => {
	it('summerer sleepLag og earlyWake når begge finnes', () => {
		expect(compositeSleepLag({ sleepLag: 12, earlyWake: 8 })).toBe(20);
	});

	it('faller tilbake på den ene som finnes', () => {
		expect(compositeSleepLag({ sleepLag: 12 })).toBe(12);
		expect(compositeSleepLag({ earlyWake: 8 })).toBe(8);
	});

	it('skiller null fra fraværende — 0 er en gyldig verdi', () => {
		expect(compositeSleepLag({ sleepLag: 0 })).toBe(0);
		expect(compositeSleepLag({ sleepLag: 0, earlyWake: 0 })).toBe(0);
	});

	it('gir null når ingenting finnes', () => {
		expect(compositeSleepLag({})).toBeNull();
		expect(compositeSleepLag(null)).toBeNull();
		expect(compositeSleepLag(undefined)).toBeNull();
	});
});


describe('buildSleepNightSeries — segmenter samme natt', () => {
	function night(start: string, durationH: number, isNap = false, end?: string) {
		return { start: new Date(start), end: end ? new Date(end) : null, durationH, isNap };
	}

	it('summerer segmenter som ender samme dato', () => {
		// Withings deler natta når man er ute av senga. 3 t + 4 t er én natt på 7,
		// ikke to netter — og uten dette fikk SleepDashboard duplikate each-nøkler.
		const series = buildSleepNightSeries([
			night('2026-08-02T22:00:00.000Z', 3, false, '2026-08-03T01:00:00.000Z'),
			night('2026-08-03T02:00:00.000Z', 4, false, '2026-08-03T06:00:00.000Z')
		]);
		expect(series).toHaveLength(1);
		expect(series[0].date).toBe('2026-08-03');
		expect(series[0].hours).toBe(7);
	});

	it('holder nap og natt fra hverandre på samme dato', () => {
		// En flis om dagen og natta er to ulike ting.
		const series = buildSleepNightSeries([
			night('2026-08-03T01:00:00.000Z', 7),
			night('2026-08-03T12:00:00.000Z', 0.5, true)
		]);
		expect(series).toHaveLength(2);
		expect(series.filter((p) => p.isNap)).toHaveLength(1);
	});

	it('summerer flere naps samme dag', () => {
		const series = buildSleepNightSeries([
			night('2026-08-03T12:00:00.000Z', 0.4, true),
			night('2026-08-03T16:00:00.000Z', 0.3, true)
		]);
		expect(series).toHaveLength(1);
		expect(series[0].hours).toBe(0.7);
	});

	it('gir unike nøkler for date+isNap i hele serien', () => {
		const series = buildSleepNightSeries([
			night('2026-08-02T22:00:00.000Z', 3, false, '2026-08-03T01:00:00.000Z'),
			night('2026-08-03T02:00:00.000Z', 4, false, '2026-08-03T06:00:00.000Z'),
			night('2026-08-03T13:00:00.000Z', 0.5, true)
		]);
		const keys = series.map((p) => `${p.date}:${p.isNap}`);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
