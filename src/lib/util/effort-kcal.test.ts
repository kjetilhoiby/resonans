import { describe, it, expect } from 'vitest';
import { buildSwapExamples, effortToKcal, kcalPerEffortPoint, weeklyKcalToKg } from './effort-kcal';

describe('effort↔kcal-broen', () => {
	it('1 effort-poeng ≈ 5,6 kcal ved 85 kg', () => {
		expect(kcalPerEffortPoint(85)).toBeCloseTo(5.61, 1);
	});

	it('ukeseffort 200 ved 85 kg ≈ ~1100 kcal ≈ ~0,15 kg', () => {
		const kcal = effortToKcal(200, 85);
		expect(kcal).toBeGreaterThan(1000);
		expect(kcal).toBeLessThan(1250);
		expect(weeklyKcalToKg(kcal)).toBeCloseTo(0.15, 1);
	});

	it('konsistens: en rolig løpetur gir ~samme kcal via effort-broen som via MET direkte', () => {
		// 30 min løp: effort = 75; broen: 75 × 0.066 × 85 ≈ 421 kcal.
		// Direkte: 9.5 MET × 0.0175 × 85 × 30 ≈ 424 kcal.
		const viaBro = effortToKcal(75, 85);
		expect(Math.abs(viaBro - 424)).toBeLessThan(25);
	});

	it('bytteeksemplene skalerer med kroppsvekt og har fornuftige størrelser', () => {
		const examples = buildSwapExamples(85, 400);
		expect(examples).toHaveLength(3);

		const fotball = examples[0];
		// 60 min fotball ≈ 700 kcal ved 85 kg; registreres som ~75 effort ('other')
		expect(fotball.kcalPerWeek).toBeGreaterThan(600);
		expect(fotball.kcalPerWeek).toBeLessThan(800);
		expect(fotball.effortPoints).toBe(75);

		const sykkelbytte = examples[1];
		// 80 min differanse (7.5−4.5 MET) ≈ 360 kcal; effort-differanse 90
		expect(sykkelbytte.kcalPerWeek).toBeGreaterThan(300);
		expect(sykkelbytte.kcalPerWeek).toBeLessThan(430);
		expect(sykkelbytte.effortPoints).toBe(90);

		const lopetur = examples[2];
		// 5 km @ 6:40 = 33.3 min → effort ~83, kcal ~470
		expect(lopetur.effortPoints).toBeGreaterThan(75);
		expect(lopetur.effortPoints).toBeLessThan(90);
		expect(lopetur.kcalPerWeek).toBeGreaterThan(400);
		expect(lopetur.kcalPerWeek).toBeLessThan(550);

		// Tyngre kropp → flere kcal, samme effort-poeng
		const heavy = buildSwapExamples(100, 400);
		expect(heavy[0].kcalPerWeek).toBeGreaterThan(fotball.kcalPerWeek);
		expect(heavy[0].effortPoints).toBe(fotball.effortPoints);
	});
});
