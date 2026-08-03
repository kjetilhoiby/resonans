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
	// Hvileforbrenningen utledet fra de rene dagene.
	const BASAL = 1958;

	it('utleder aktiviteten fra totalen, ikke fra calories-feltet', () => {
		// 3. august: totalen minus hvile gir 805, som er nettopp hva øktene tilsier
		// (698 fra Withings' egne økt-tall pluss 2 378 skritt). calories-feltet sa
		// 1 460, altså 654 for høyt.
		const breakdown = describeExpenditure({
			totalKcal: 2763.46,
			reportedActivityKcal: 1459.6,
			basalKcal: BASAL,
			workoutKcal: 698
		});
		expect(breakdown.activityKcal).toBe(805);
		expect(breakdown.reportedActivityKcal).toBe(1460);
		expect(breakdown.activityFieldDeviationKcal).toBe(655);
		expect(breakdown.activityFieldSuspect).toBe(true);
		// Totalen mistros IKKE — den er den konsistente kilden.
		expect(breakdown.totalKcal).toBe(2763);
	});

	it('lar de rene dagene passere uten flagg', () => {
		// På disse treffer calories-feltet innenfor 12 kcal.
		for (const [total, reported, expected] of [
			[2429.61, 476.23, 472],
			[2698.7, 728.36, 741],
			[2276.31, 318.37, 318]
		] as [number, number, number][]) {
			const breakdown = describeExpenditure({
				totalKcal: total,
				reportedActivityKcal: reported,
				basalKcal: BASAL
			});
			expect(breakdown.activityKcal, String(total)).toBe(expected);
			expect(breakdown.activityFieldSuspect, String(total)).toBe(false);
		}
	});

	it('treffer toleransegrensa', () => {
		const inside = describeExpenditure({
			totalKcal: 2500,
			reportedActivityKcal: 542 + RECONCILE_TOLERANCE_KCAL,
			basalKcal: 1958
		});
		expect(inside.activityFieldSuspect).toBe(false);

		const outside = describeExpenditure({
			totalKcal: 2500,
			reportedActivityKcal: 542 + RECONCILE_TOLERANCE_KCAL + 1,
			basalKcal: 1958
		});
		expect(outside.activityFieldSuspect).toBe(true);
	});

	it('påstår ingenting når grunnlaget mangler', () => {
		const noBasal = describeExpenditure({
			totalKcal: 2500,
			reportedActivityKcal: 400,
			basalKcal: null
		});
		expect(noBasal.activityKcal).toBeNull();
		expect(noBasal.activityFieldDeviationKcal).toBeNull();
		expect(noBasal.activityFieldSuspect).toBe(false);

		const noField = describeExpenditure({
			totalKcal: 2500,
			reportedActivityKcal: null,
			basalKcal: 1958
		});
		expect(noField.activityKcal).toBe(542);
		expect(noField.activityFieldSuspect).toBe(false);
	});

	it('tar med øktsummen når den er kjent', () => {
		const breakdown = describeExpenditure({
			totalKcal: 2763,
			reportedActivityKcal: 1460,
			basalKcal: BASAL,
			workoutKcal: 698
		});
		expect(breakdown.workoutKcal).toBe(698);
	});
});
