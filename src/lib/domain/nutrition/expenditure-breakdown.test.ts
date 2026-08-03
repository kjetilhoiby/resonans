import { describe, it, expect } from 'vitest';
import {
	deriveBasalMetabolism,
	describeExpenditure,
	RECONCILE_TOLERANCE_KCAL
} from './expenditure-breakdown';

/** Ekte Withings-rader, 31. juli–3. august 2026. */
const REAL_DAYS = [
	{ totalCalories: 2429.61, activityCalories: 476.23 }, // 31. juli → 1 953
	{ totalCalories: 2698.7, activityCalories: 728.36 }, // 1. august → 1 970
	{ totalCalories: 2276.31, activityCalories: 318.37 }, // 2. august → 1 958
	{ totalCalories: 2763.46, activityCalories: 1459.6 } // 3. august → 1 304 (uenig)
];

describe('deriveBasalMetabolism', () => {
	it('finner hvileforbrenningen fra differansen', () => {
		// Tre dager stemmer på 1 953–1 970. Medianen skal ligge der.
		const basal = deriveBasalMetabolism(REAL_DAYS.slice(0, 3));
		expect(basal).toBe(1958);
	});

	it('lar ikke én uenig dag dra tallet ned', () => {
		// 3. august ga 1 304 fordi feltene ikke er i takt. Medianen tåler det;
		// snittet ville falt til 1 796.
		expect(deriveBasalMetabolism(REAL_DAYS)).toBe(1956);
	});

	it('forkaster verdier som ikke kan være hvileforbrenning', () => {
		const days = [
			{ totalCalories: 400, activityCalories: 100 }, // 300 — for lavt
			{ totalCalories: 9000, activityCalories: 100 }, // 8900 — for høyt
			{ totalCalories: 2400, activityCalories: 450 } // 1950 — greit
		];
		expect(deriveBasalMetabolism(days)).toBe(1950);
	});

	it('gir null uten grunnlag', () => {
		expect(deriveBasalMetabolism([])).toBeNull();
		expect(deriveBasalMetabolism([{ totalCalories: 2400, activityCalories: null }])).toBeNull();
		expect(deriveBasalMetabolism([{ totalCalories: null, activityCalories: 300 }])).toBeNull();
	});
});

describe('describeExpenditure', () => {
	it('splitter en normal dag i hvile og aktivitet', () => {
		// 1. august: 1 970 hvile + 728 aktivitet = 2 698, som er totalen.
		const breakdown = describeExpenditure({
			reportedKcal: 2698.7,
			activityKcal: 728.36,
			basalKcal: 1958
		});
		expect(breakdown.impliedKcal).toBe(2686);
		expect(breakdown.discrepancyKcal).toBe(13);
		expect(breakdown.reconciles).toBe(true);
	});

	it('avslører at 3. august ikke henger sammen', () => {
		// Dette er spørsmålet brukeren stilte. 1 460 aktivitet + 1 958 hvile er
		// 3 418, men Withings oppgir 2 763 — over 600 kcal fra hverandre.
		const breakdown = describeExpenditure({
			reportedKcal: 2763.46,
			activityKcal: 1459.6,
			basalKcal: 1958
		});
		expect(breakdown.impliedKcal).toBe(3418);
		expect(breakdown.discrepancyKcal).toBe(-655);
		expect(breakdown.reconciles).toBe(false);
	});

	it('treffer toleransegrensa', () => {
		const inside = describeExpenditure({
			reportedKcal: 2000 + RECONCILE_TOLERANCE_KCAL,
			activityKcal: 500,
			basalKcal: 1500
		});
		expect(inside.reconciles).toBe(true);

		const outside = describeExpenditure({
			reportedKcal: 2000 + RECONCILE_TOLERANCE_KCAL + 1,
			activityKcal: 500,
			basalKcal: 1500
		});
		expect(outside.reconciles).toBe(false);
	});

	it('påstår ikke uenighet når grunnlaget mangler', () => {
		// Ukjent er ikke det samme som feil.
		const noBasal = describeExpenditure({ reportedKcal: 2500, activityKcal: 400, basalKcal: null });
		expect(noBasal.impliedKcal).toBeNull();
		expect(noBasal.discrepancyKcal).toBeNull();
		expect(noBasal.reconciles).toBe(true);

		const noActivity = describeExpenditure({
			reportedKcal: 2500,
			activityKcal: null,
			basalKcal: 1958
		});
		expect(noActivity.reconciles).toBe(true);
	});
});
