import { describe, it, expect } from 'vitest';
import {
	buildIntradayEnergy,
	expenditureAtMinute,
	intakeAtMinute,
	minuteLabel,
	MINUTES_PER_DAY,
	SLEEP_HOUR,
	WAKE_HOUR
} from './intraday-energy';

/** Tallene fra prod 3. august: hvile 1 958, kontorhverdag 2 448, 294 fra to økter. */
const MODEL = { basalKcal: 1958, baselineKcal: 2448, workouts: [] };

describe('expenditureAtMinute', () => {
	it('starter på 0 og ender på døgnanslaget', () => {
		expect(expenditureAtMinute(0, MODEL)).toBe(0);
		expect(expenditureAtMinute(MINUTES_PER_DAY, MODEL)).toBeCloseTo(2448, 6);
	});

	it('brenner hvile mens man sover, men ikke kontorpåslag', () => {
		// Kl. 05 er man ikke våken: bare hvilestoffskiftet skal ha løpt.
		const at5 = expenditureAtMinute(5 * 60, MODEL);
		expect(at5).toBeCloseTo((1958 / 1440) * 300, 6);

		// Og det er mindre enn en jevn fordeling av hele døgnanslaget ville gitt.
		expect(at5).toBeLessThan((2448 / 1440) * 300);
	});

	it('fordeler kontorpåslaget over våken tid', () => {
		const uplift = 2448 - 1958;
		const wakeMinutes = (SLEEP_HOUR - WAKE_HOUR) * 60;

		// Ved våkning er påslaget ikke begynt.
		const atWake = expenditureAtMinute(WAKE_HOUR * 60, MODEL);
		expect(atWake).toBeCloseTo((1958 / 1440) * WAKE_HOUR * 60, 6);

		// Midt i våkenvinduet er halve påslaget brukt.
		const mid = WAKE_HOUR * 60 + wakeMinutes / 2;
		expect(expenditureAtMinute(mid, MODEL) - (1958 / 1440) * mid).toBeCloseTo(uplift / 2, 6);

		// Etter leggetid står påslaget stille — bare hvile fortsetter.
		const atSleep = expenditureAtMinute(SLEEP_HOUR * 60, MODEL);
		const atMidnight = expenditureAtMinute(MINUTES_PER_DAY, MODEL);
		expect(atMidnight - atSleep).toBeCloseTo((1958 / 1440) * 60, 6);
	});

	it('legger økta inn der den skjedde, ikke før', () => {
		const withWorkout = {
			...MODEL,
			workouts: [{ startMinute: 18 * 60, durationMinutes: 60, kcal: 300 }]
		};
		// Før økta: ingen forskjell.
		expect(expenditureAtMinute(17 * 60, withWorkout)).toBeCloseTo(
			expenditureAtMinute(17 * 60, MODEL),
			6
		);
		// Halvveis: halve økta.
		expect(
			expenditureAtMinute(18 * 60 + 30, withWorkout) - expenditureAtMinute(18 * 60 + 30, MODEL)
		).toBeCloseTo(150, 6);
		// Etter: hele.
		expect(
			expenditureAtMinute(20 * 60, withWorkout) - expenditureAtMinute(20 * 60, MODEL)
		).toBeCloseTo(300, 6);
	});

	it('klemmer minutter utenfor døgnet', () => {
		expect(expenditureAtMinute(-100, MODEL)).toBe(0);
		expect(expenditureAtMinute(9999, MODEL)).toBeCloseTo(2448, 6);
	});
});

describe('intakeAtMinute', () => {
	const meals = [
		{ minute: 7 * 60 + 10, kcal: 304 },
		{ minute: 12 * 60, kcal: 610 },
		{ minute: 16 * 60 + 15, kcal: 606 }
	];

	it('er en trappefunksjon', () => {
		expect(intakeAtMinute(0, meals)).toBe(0);
		expect(intakeAtMinute(7 * 60 + 9, meals)).toBe(0);
		expect(intakeAtMinute(7 * 60 + 10, meals)).toBe(304);
		expect(intakeAtMinute(12 * 60, meals)).toBe(914);
		expect(intakeAtMinute(23 * 60, meals)).toBe(1520);
	});
});

describe('buildIntradayEnergy', () => {
	const meals = [
		{ minute: 7 * 60 + 10, kcal: 304 },
		{ minute: 12 * 60, kcal: 610 },
		{ minute: 16 * 60 + 15, kcal: 606 }
	];

	it('gjør begge sidene «så langt», som er hele poenget', () => {
		// Kl. 17:03, prod-tallene. Forbrent så langt skal være godt under døgnanslaget
		// 2 448 — det var feilen den gamle visningen gjorde.
		const result = buildIntradayEnergy({
			nowMinute: 17 * 60 + 3,
			basalKcal: 1958,
			baselineKcal: 2448,
			meals,
			workouts: []
		})!;

		expect(result.intakeNow).toBe(1520);
		expect(result.expenditureNow).toBeLessThan(2448);
		expect(result.expenditureNow).toBeGreaterThan(1200);
		expect(result.gapNow).toBe(result.expenditureNow - result.intakeNow);
		expect(result.expenditureFullDay).toBe(2448);
	});

	it('returnerer null uten kroppsprofil framfor å gjette', () => {
		const base = { nowMinute: 600, meals, workouts: [] };
		expect(buildIntradayEnergy({ ...base, basalKcal: null, baselineKcal: 2448 })).toBeNull();
		expect(buildIntradayEnergy({ ...base, basalKcal: 1958, baselineKcal: null })).toBeNull();
		expect(buildIntradayEnergy({ ...base, basalKcal: 0, baselineKcal: 2448 })).toBeNull();
	});

	it('har et punkt nøyaktig på hvert måltid', () => {
		// Ellers ville et måltid flyttet seg opptil et kvarter på rutenettet.
		const result = buildIntradayEnergy({
			nowMinute: 20 * 60,
			basalKcal: 1958,
			baselineKcal: 2448,
			meals,
			workouts: []
		})!;
		for (const meal of meals) {
			expect(result.points.some((p) => p.minute === meal.minute)).toBe(true);
		}
	});

	it('holder kurvene monotone', () => {
		const result = buildIntradayEnergy({
			nowMinute: 22 * 60,
			basalKcal: 1958,
			baselineKcal: 2448,
			meals,
			workouts: [{ startMinute: 18 * 60, durationMinutes: 45, kcal: 294 }]
		})!;
		for (let i = 1; i < result.points.length; i++) {
			expect(result.points[i].intakeKcal).toBeGreaterThanOrEqual(result.points[i - 1].intakeKcal);
			expect(result.points[i].expenditureKcal).toBeGreaterThanOrEqual(
				result.points[i - 1].expenditureKcal
			);
		}
	});

	it('projiserer forbruket til midnatt, men ikke inntaket', () => {
		const result = buildIntradayEnergy({
			nowMinute: 15 * 60,
			basalKcal: 1958,
			baselineKcal: 2448,
			meals,
			workouts: []
		})!;

		const last = result.projection[result.projection.length - 1];
		expect(last.minute).toBe(MINUTES_PER_DAY);
		expect(last.expenditureKcal).toBe(2448);
		// Inntaket står stille: vi vet ikke hva som blir spist resten av dagen.
		expect(last.intakeKcal).toBe(result.intakeNow);
	});

	it('starter projeksjonen der kurven slutter', () => {
		const result = buildIntradayEnergy({
			nowMinute: 15 * 60,
			basalKcal: 1958,
			baselineKcal: 2448,
			meals,
			workouts: []
		})!;
		expect(result.projection[0].minute).toBe(result.nowMinute);
		expect(result.projection[0].expenditureKcal).toBe(result.expenditureNow);
	});

	it('tåler midnatt og en dag uten mat', () => {
		const atMidnight = buildIntradayEnergy({
			nowMinute: MINUTES_PER_DAY,
			basalKcal: 1958,
			baselineKcal: 2448,
			meals: [],
			workouts: []
		})!;
		expect(atMidnight.intakeNow).toBe(0);
		expect(atMidnight.expenditureNow).toBe(2448);
		expect(atMidnight.gapNow).toBe(2448);
	});

	it('ignorerer måltider uten kalorier', () => {
		const result = buildIntradayEnergy({
			nowMinute: 12 * 60,
			basalKcal: 1958,
			baselineKcal: 2448,
			meals: [{ minute: 480, kcal: 0 }, { minute: 500, kcal: Number.NaN }],
			workouts: []
		})!;
		expect(result.intakeNow).toBe(0);
	});
});

describe('minuteLabel', () => {
	it('formaterer klokkeslett', () => {
		expect(minuteLabel(0)).toBe('00:00');
		expect(minuteLabel(7 * 60 + 5)).toBe('07:05');
		expect(minuteLabel(17 * 60 + 3)).toBe('17:03');
		expect(minuteLabel(MINUTES_PER_DAY)).toBe('00:00');
	});
});
