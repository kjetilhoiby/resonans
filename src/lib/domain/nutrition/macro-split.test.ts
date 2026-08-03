import { describe, it, expect } from 'vitest';
import { formatShare, macroEnergySplit } from './macro-split';

/** Tallene fra skjermbildet 3. august kl. 15:57. */
const DAY = { kcal: 634, proteinG: 31.2, carbsG: 50.9, fatG: 32.1 };

describe('macroEnergySplit', () => {
	it('viser at fett er største energikilde selv med minst gram', () => {
		// Dette er hele poenget med visualiseringen: fett har færrest gram av de
		// tre store, men flest kalorier, fordi 9 kcal/g mot 4.
		const split = macroEnergySplit(DAY)!;
		const fat = split.slices.find((s) => s.key === 'fat')!;
		const carbs = split.slices.find((s) => s.key === 'carbs')!;
		expect(fat.grams).toBeLessThan(carbs.grams);
		expect(fat.kcal).toBeGreaterThan(carbs.kcal);
		expect(fat.share).toBeGreaterThan(carbs.share);
	});

	it('regner andeler som summerer til 100 %', () => {
		const split = macroEnergySplit(DAY)!;
		const sum = split.slices.reduce((acc, s) => acc + s.share, 0);
		expect(sum).toBeCloseTo(1, 10);
	});

	it('rapporterer avviket mot det loggede kcal-tallet', () => {
		// 31,2·4 + 50,9·4 + 32,1·9 = 617,3. Logget er 634.
		const split = macroEnergySplit(DAY)!;
		expect(split.macroKcal).toBe(617);
		expect(split.loggedKcal).toBe(634);
		expect(split.unaccountedKcal).toBe(17);
		// 17 av 634 er under 10 %, altså ikke verdt å nevne.
		expect(split.worthMentioning).toBe(false);
	});

	it('flagger et avvik som er stort nok til å bety noe', () => {
		const split = macroEnergySplit({ kcal: 1000, proteinG: 20, carbsG: 50, fatG: 20 })!;
		// 80 + 200 + 180 = 460 mot 1000 logget.
		expect(split.macroKcal).toBe(460);
		expect(split.unaccountedKcal).toBe(540);
		expect(split.worthMentioning).toBe(true);
	});

	it('håndterer negativt avvik — makroene kan forklare mer enn logget', () => {
		const split = macroEnergySplit({ kcal: 500, proteinG: 30, carbsG: 60, fatG: 30 })!;
		expect(split.macroKcal).toBe(630);
		expect(split.unaccountedKcal).toBe(-130);
		expect(split.unaccountedShare).toBeCloseTo(0.26, 2);
	});

	it('beholder rekkefølgen protein, karbo, fett', () => {
		// Fargene tildeles i samme rekkefølge, så et segment må ikke bytte plass
		// når et annet blir null.
		expect(macroEnergySplit(DAY)!.slices.map((s) => s.key)).toEqual(['protein', 'carbs', 'fat']);
		const noCarbs = macroEnergySplit({ kcal: 400, proteinG: 40, carbsG: 0, fatG: 24 })!;
		expect(noCarbs.slices.map((s) => s.key)).toEqual(['protein', 'carbs', 'fat']);
		expect(noCarbs.slices[1].share).toBe(0);
	});

	it('gir null når det ikke er noen makroer å vise', () => {
		// En stolpe uten segmenter er verre enn ingen stolpe.
		expect(macroEnergySplit({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 })).toBeNull();
		expect(macroEnergySplit({ kcal: 500, proteinG: 0, carbsG: 0, fatG: 0 })).toBeNull();
	});

	it('behandler tull som null framfor å kaste', () => {
		const split = macroEnergySplit({
			kcal: Number.NaN,
			proteinG: 30,
			carbsG: -5,
			fatG: 10
		} as never)!;
		expect(split.slices.find((s) => s.key === 'carbs')!.grams).toBe(0);
		expect(split.loggedKcal).toBe(0);
		expect(split.unaccountedShare).toBeNull();
	});
});

describe('formatShare', () => {
	it('runder til hele prosent', () => {
		expect(formatShare(0.468)).toBe('47 %');
		expect(formatShare(0)).toBe('0 %');
		expect(formatShare(1)).toBe('100 %');
	});
});
