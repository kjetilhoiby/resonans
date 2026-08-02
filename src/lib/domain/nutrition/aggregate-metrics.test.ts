import { describe, it, expect } from 'vitest';
import { computeNutritionMetrics, type NutritionEventLike } from './aggregate-metrics';

function meal(overrides: Partial<NutritionEventLike> & { kcal?: number; proteinG?: number } = {}): NutritionEventLike {
	const { kcal = 500, proteinG = 25, ...rest } = overrides;
	return {
		dataType: 'nutrition',
		timestamp: '2026-08-02T10:00:00.000Z',
		data: { kcal, proteinG, carbsG: 50, fatG: 20 },
		...rest
	};
}

describe('computeNutritionMetrics', () => {
	it('summerer perioden og teller måltid', () => {
		const result = computeNutritionMetrics([meal(), meal({ kcal: 700, proteinG: 35 })]);
		expect(result).not.toBeNull();
		expect(result!.kcalSum).toBe(1200);
		expect(result!.proteinSum).toBe(60);
		expect(result!.mealCount).toBe(2);
	});

	it('ignorerer hendelser som ikke er ernæring', () => {
		// Uke-aggregeringen sender ALLE sensorhendelser inn. En vektmåling har
		// ingen kcal, men en treningsøkt har `calories` — forbrente, ikke spiste.
		const result = computeNutritionMetrics([
			meal(),
			{ dataType: 'weight', timestamp: '2026-08-02T06:00:00.000Z', data: { weight: 82 } },
			{ dataType: 'workout', timestamp: '2026-08-02T17:00:00.000Z', data: { calories: 650 } }
		]);
		expect(result!.kcalSum).toBe(500);
		expect(result!.mealCount).toBe(1);
	});

	it('gir null når perioden ikke har ernæringshendelser', () => {
		// Null og ikke nullfylt objekt: en periode med kcalSum 0 ville sett ut
		// som en dag man ikke spiste.
		expect(computeNutritionMetrics([])).toBeNull();
		expect(
			computeNutritionMetrics([{ dataType: 'weight', timestamp: '2026-08-02T06:00:00.000Z', data: { weight: 82 } }])
		).toBeNull();
	});

	it('teller loggede dager etter Osloklokka', () => {
		// 23:30 UTC er 01:30 neste dag i Oslo — to ulike dager.
		const result = computeNutritionMetrics([
			meal({ timestamp: '2026-08-02T20:00:00.000Z' }),
			meal({ timestamp: '2026-08-02T23:30:00.000Z' })
		]);
		expect(result!.loggedDays).toBe(2);
	});

	it('snitter per logget dag, ikke per måltid', () => {
		const result = computeNutritionMetrics([
			meal({ timestamp: '2026-08-01T08:00:00.000Z', kcal: 400, proteinG: 20 }),
			meal({ timestamp: '2026-08-01T18:00:00.000Z', kcal: 600, proteinG: 30 }),
			meal({ timestamp: '2026-08-03T12:00:00.000Z', kcal: 1000, proteinG: 50 })
		]);
		expect(result!.loggedDays).toBe(2);
		expect(result!.mealCount).toBe(3);
		expect(result!.kcalPerDay).toBe(1000);
		expect(result!.proteinPerDay).toBe(50);
	});

	it('behandler manglende og ugyldige makroer som 0', () => {
		const result = computeNutritionMetrics([
			{ dataType: 'nutrition', timestamp: '2026-08-02T10:00:00.000Z', data: {} },
			{ dataType: 'nutrition', timestamp: '2026-08-02T11:00:00.000Z', data: null },
			{ dataType: 'nutrition', timestamp: '2026-08-02T12:00:00.000Z', data: { kcal: 'mye', proteinG: -3 } },
			meal({ timestamp: '2026-08-02T13:00:00.000Z', kcal: 300, proteinG: 10 })
		]);
		expect(result!.kcalSum).toBe(300);
		expect(result!.proteinSum).toBe(10);
		expect(result!.mealCount).toBe(4);
	});

	it('godtar Date like godt som streng', () => {
		const result = computeNutritionMetrics([meal({ timestamp: new Date('2026-08-02T10:00:00.000Z') })]);
		expect(result!.loggedDays).toBe(1);
	});

	it('deler ikke på null når alle tidspunkt er ugyldige', () => {
		const result = computeNutritionMetrics([meal({ timestamp: 'tull', kcal: 500 })]);
		expect(result!.loggedDays).toBe(0);
		expect(result!.kcalPerDay).toBe(500);
		expect(Number.isFinite(result!.kcalPerDay)).toBe(true);
	});

	it('runder gram til én desimal og kcal til hele', () => {
		const result = computeNutritionMetrics([
			meal({ kcal: 333.33, proteinG: 11.11 }),
			meal({ kcal: 333.33, proteinG: 11.11, timestamp: '2026-08-03T10:00:00.000Z' })
		]);
		expect(result!.kcalSum).toBe(667);
		expect(result!.proteinSum).toBe(22.2);
		expect(result!.kcalPerDay).toBe(333);
	});
});
