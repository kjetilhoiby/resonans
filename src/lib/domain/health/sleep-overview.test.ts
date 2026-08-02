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
