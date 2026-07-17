import { describe, it, expect } from 'vitest';
import {
	defaultSleepGoalTitle,
	evaluateSleepGoal,
	isNap,
	isNapSleepEvent,
	medianBedtimeMinutes,
	medianWakeMinutes,
	noonAxisMinutes,
	noonAxisToHHMM,
	parseTimeToNoonAxis,
	readSleepGoalMetadata,
	toSleepNights,
	type RawSleepEventLike
} from './sleep-goals';

/** Lag en rå sleep-event: start (ISO, UTC), varighet i timer. Oslo er UTC+2 om sommeren. */
function sleepEvent(startIso: string, durationH: number): RawSleepEventLike {
	const start = new Date(startIso);
	return {
		timestamp: start,
		data: { sleepDuration: Math.round(durationH * 3600) },
		metadata: { enddate: Math.round(start.getTime() / 1000 + durationH * 3600) }
	};
}

describe('isNap', () => {
	it('kort søvn på dagtid → nap (13:00 lokal Oslo-tid)', () => {
		// 11:00 UTC = 13:00 Oslo (sommertid)
		expect(isNap(new Date('2026-07-14T11:00:00Z'), 0.5)).toBe(true);
		expect(isNap(new Date('2026-07-14T11:00:00Z'), 2.9)).toBe(true);
	});

	it('nattesøvn er aldri nap — selv når den er kort', () => {
		// 21:30 UTC = 23:30 Oslo
		expect(isNap(new Date('2026-07-14T21:30:00Z'), 2)).toBe(false);
		// 04:00 UTC = 06:00 Oslo (tidlig morgen er utenfor 09–21)
		expect(isNap(new Date('2026-07-14T04:00:00Z'), 1.5)).toBe(false);
	});

	it('lang søvn på dagtid (≥3t, f.eks. nattskift) er ikke nap', () => {
		expect(isNap(new Date('2026-07-14T11:00:00Z'), 5)).toBe(false);
	});
});

describe('toSleepNights + isNapSleepEvent', () => {
	it('mapper netter og flagger naps', () => {
		const events = [
			sleepEvent('2026-07-13T21:04:00Z', 7.4), // 23:04 Oslo → natt
			sleepEvent('2026-07-14T12:15:00Z', 0.6), // 14:15 Oslo → nap
			sleepEvent('2026-07-14T22:30:00Z', 6.8) // 00:30 Oslo → natt
		];
		const nights = toSleepNights(events);
		expect(nights.map((n) => n.isNap)).toEqual([false, true, false]);
		expect(nights[0].durationH).toBeCloseTo(7.4, 1);
		expect(isNapSleepEvent(events[1])).toBe(true);
		expect(isNapSleepEvent(events[0])).toBe(false);
	});

	it('event uten varighet faller tilbake til start→slutt-spennet, ellers droppes', () => {
		const start = new Date('2026-07-13T21:00:00Z');
		const withSpan: RawSleepEventLike = {
			timestamp: start,
			data: {},
			metadata: { enddate: start.getTime() / 1000 + 8 * 3600 }
		};
		const useless: RawSleepEventLike = { timestamp: start, data: {}, metadata: {} };
		const nights = toSleepNights([withSpan, useless]);
		expect(nights).toHaveLength(1);
		expect(nights[0].durationH).toBeCloseTo(8, 1);
	});
});

describe('middag-aksen', () => {
	it('gjør leggetider rundt midnatt sammenlignbare', () => {
		// 21:30 UTC = 23:30 Oslo → 690; 22:30 UTC = 00:30 Oslo → 750
		expect(noonAxisMinutes(new Date('2026-07-14T21:30:00Z'))).toBe(690);
		expect(noonAxisMinutes(new Date('2026-07-14T22:30:00Z'))).toBe(750);
	});

	it('parser og formaterer HH:MM begge veier', () => {
		expect(parseTimeToNoonAxis('23:00')).toBe(660);
		expect(parseTimeToNoonAxis('06:30')).toBe(1110);
		expect(parseTimeToNoonAxis('tull')).toBeNull();
		expect(noonAxisToHHMM(660)).toBe('23:00');
		expect(noonAxisToHHMM(1110)).toBe('06:30');
	});

	it('median leggetid og oppvåkning ignorerer naps', () => {
		const nights = toSleepNights([
			sleepEvent('2026-07-12T21:00:00Z', 7), // legg 23:00, våken 06:00 Oslo
			sleepEvent('2026-07-13T22:00:00Z', 7), // legg 00:00, våken 07:00 Oslo
			sleepEvent('2026-07-14T21:30:00Z', 7), // legg 23:30, våken 06:30 Oslo
			sleepEvent('2026-07-15T12:00:00Z', 0.5) // nap — skal ikke telle
		]);
		expect(medianBedtimeMinutes(nights)).toBe(690); // 23:30
		expect(medianWakeMinutes(nights)).toBe(1110); // 06:30
	});
});

describe('evaluateSleepGoal', () => {
	const nights = toSleepNights([
		sleepEvent('2026-07-12T21:00:00Z', 7.5),
		sleepEvent('2026-07-13T22:00:00Z', 6.5),
		sleepEvent('2026-07-14T21:30:00Z', 8),
		sleepEvent('2026-07-15T12:00:00Z', 0.5) // nap
	]);

	it('duration: snitt av ekte netter mot måltimer', () => {
		const evalOk = evaluateSleepGoal({ kind: 'duration', targetHours: 7 }, nights);
		expect(evalOk.value).toBeCloseTo(7.33, 1);
		expect(evalOk.withinTarget).toBe(true);
		expect(evalOk.mode).toBe('at_least');
		expect(evalOk.napCount).toBe(1);
		expect(evalOk.nightCount).toBe(3);

		const evalOver = evaluateSleepGoal({ kind: 'duration', targetHours: 8 }, nights);
		expect(evalOver.withinTarget).toBe(false);
	});

	it('bedtime: median mot måltid ± slingring', () => {
		// median leggetid = 23:30 (690)
		const within = evaluateSleepGoal(
			{ kind: 'bedtime', targetTime: '23:15', toleranceMinutes: 30 },
			nights
		);
		expect(within.currentLabel).toBe('23:30');
		expect(within.withinTarget).toBe(true);

		const outside = evaluateSleepGoal(
			{ kind: 'bedtime', targetTime: '22:30', toleranceMinutes: 30 },
			nights
		);
		expect(outside.withinTarget).toBe(false);
	});

	it('uten netter → null-verdier, ingen dom', () => {
		const empty = evaluateSleepGoal({ kind: 'duration', targetHours: 7 }, []);
		expect(empty.value).toBeNull();
		expect(empty.withinTarget).toBeNull();
	});
});

describe('readSleepGoalMetadata', () => {
	it('leser gyldige mål og avviser resten', () => {
		expect(readSleepGoalMetadata({ sleepGoal: { kind: 'duration', targetHours: 7.5 } })).toEqual({
			kind: 'duration',
			targetHours: 7.5
		});
		expect(
			readSleepGoalMetadata({ sleepGoal: { kind: 'bedtime', targetTime: '23:00' } })
		).toMatchObject({ kind: 'bedtime', targetTime: '23:00' });
		expect(readSleepGoalMetadata({ sleepGoal: { kind: 'bedtime', targetTime: 'sent' } })).toBeNull();
		expect(readSleepGoalMetadata({ screenTimeGoal: {} })).toBeNull();
		expect(readSleepGoalMetadata(null)).toBeNull();
	});
});

describe('defaultSleepGoalTitle', () => {
	it('bygger norske titler per type', () => {
		expect(defaultSleepGoalTitle({ kind: 'duration', targetHours: 7.5 })).toBe('Søvn over 7,5t/natt');
		expect(defaultSleepGoalTitle({ kind: 'bedtime', targetTime: '23:00' })).toBe('Leggetid rundt 23:00');
		expect(defaultSleepGoalTitle({ kind: 'waketime', targetTime: '06:30' })).toBe('Våken rundt 06:30');
	});
});
