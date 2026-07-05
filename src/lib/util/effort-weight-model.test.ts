import { describe, it, expect } from 'vitest';
import {
	buildWeeklyPairs,
	fitEffortWeightModel,
	predictDeltaKg,
	type WeeklyEffortWeightInput,
	type WeeklyEffortWeightPoint
} from './effort-weight-model';

function week(i: number, weightAvg: number | null, effort: number, weighInCount = 3): WeeklyEffortWeightInput {
	return { weekKey: `2026W${String(i).padStart(2, '0')}`, weightAvg, weighInCount, effort };
}

/** Syntetisk serie som følger ΔW = a + b·E eksakt (uten støy). */
function exactSeries(a: number, b: number, efforts: number[], startWeight = 90): WeeklyEffortWeightInput[] {
	const weeks: WeeklyEffortWeightInput[] = [week(1, startWeight, 0)];
	let w = startWeight;
	efforts.forEach((e, i) => {
		w += a + b * e;
		weeks.push(week(i + 2, w, e));
	});
	return weeks;
}

// Deterministisk "støy" (ingen Math.random i tester som skal være reproduserbare)
const NOISE = [0.08, -0.05, 0.03, -0.09, 0.06, -0.02, 0.07, -0.06, 0.01, -0.04, 0.05, -0.07, 0.02, 0.04];

describe('buildWeeklyPairs', () => {
	it('bygger par av påfølgende uker med nok veiinger', () => {
		const pairs = buildWeeklyPairs([week(1, 90, 100), week(2, 89.5, 200), week(3, 89.2, 250)]);
		expect(pairs).toEqual([
			{ weekKey: '2026W02', effort: 200, weightDeltaKg: -0.5 },
			{ weekKey: '2026W03', effort: 250, weightDeltaKg: -0.3 }
		]);
	});

	it('ekskluderer uker med færre enn 2 veiinger', () => {
		const pairs = buildWeeklyPairs([week(1, 90, 100), week(2, 89.5, 200, 1), week(3, 89.2, 250)]);
		expect(pairs).toEqual([]);
	});

	it('dropper par ved hull i vektserien, men fortsetter etterpå', () => {
		const pairs = buildWeeklyPairs([week(1, 90, 100), week(2, null, 200, 0), week(3, 89.2, 250), week(4, 89.0, 180)]);
		expect(pairs).toEqual([{ weekKey: '2026W04', effort: 180, weightDeltaKg: -0.2 }]);
	});

	it('inkluderer null-effort-uker som gyldige punkter (reell hvileuke)', () => {
		const pairs = buildWeeklyPairs([week(1, 90, 150), week(2, 90.4, 0)]);
		expect(pairs).toEqual([{ weekKey: '2026W02', effort: 0, weightDeltaKg: 0.4 }]);
	});
});

describe('fitEffortWeightModel', () => {
	it('gjenfinner terskelen eksakt fra støyfri serie (ΔW = 0.5 − 0.002·E → terskel 250)', () => {
		const weeks = exactSeries(0.5, -0.002, [100, 300, 200, 400, 150, 350, 250, 50, 320, 180, 280, 120]);
		const model = fitEffortWeightModel(buildWeeklyPairs(weeks));
		expect(model.slope).toBeCloseTo(-0.002, 6);
		expect(model.intercept).toBeCloseTo(0.5, 6);
		expect(model.thresholdEffort).toBe(250);
		expect(model.quality).toBe('good');
		expect(model.extrapolated).toBe(false);
	});

	it('finner terskelen innen ±15 % med deterministisk støy', () => {
		const weeks = exactSeries(0.5, -0.002, [100, 300, 200, 400, 150, 350, 250, 50, 320, 180, 280, 120, 220, 380]);
		const noisy = weeks.map((w, i) =>
			w.weightAvg == null ? w : { ...w, weightAvg: w.weightAvg + NOISE[i % NOISE.length] }
		);
		const model = fitEffortWeightModel(buildWeeklyPairs(noisy));
		expect(model.thresholdEffort).not.toBeNull();
		expect(model.thresholdEffort!).toBeGreaterThan(250 * 0.85);
		expect(model.thresholdEffort!).toBeLessThan(250 * 1.15);
	});

	it('gir insufficient og null terskel ved færre enn 6 uker', () => {
		const weeks = exactSeries(0.5, -0.002, [100, 300, 200]);
		const model = fitEffortWeightModel(buildWeeklyPairs(weeks));
		expect(model.quality).toBe('insufficient');
		expect(model.thresholdEffort).toBeNull();
	});

	it('gir weak og null terskel ved positiv helning (mer trening → mer vekt)', () => {
		const weeks = exactSeries(-0.3, 0.002, [100, 300, 200, 400, 150, 350, 250, 50]);
		const model = fitEffortWeightModel(buildWeeklyPairs(weeks));
		expect(model.quality).toBe('weak');
		expect(model.thresholdEffort).toBeNull();
	});

	it('gir weak når vekta er flat uansett effort (ingen samvariasjon)', () => {
		const weeks = [
			week(1, 90, 0),
			week(2, 90, 100),
			week(3, 90, 300),
			week(4, 90, 50),
			week(5, 90, 250),
			week(6, 90, 150),
			week(7, 90, 350),
			week(8, 90, 200)
		];
		const model = fitEffortWeightModel(buildWeeklyPairs(weeks));
		expect(model.quality).toBe('weak');
		expect(model.thresholdEffort).toBeNull();
	});

	it('flagger extrapolated når terskelen ligger langt over observert effort', () => {
		// ΔW = 0.5 − 0.001·E → terskel 500, men maks observert effort er 200
		const weeks = exactSeries(0.5, -0.001, [100, 150, 80, 200, 120, 180, 90, 160, 140, 110, 170, 130]);
		const model = fitEffortWeightModel(buildWeeklyPairs(weeks));
		expect(model.thresholdEffort).toBe(500);
		expect(model.extrapolated).toBe(true);
	});

	it('klamper negativ terskel til 0 (vekta faller selv uten trening)', () => {
		// ΔW = −0.2 − 0.002·E → terskel −100 → 0
		const weeks = exactSeries(-0.2, -0.002, [100, 300, 200, 400, 150, 350, 250, 50, 320, 180, 280, 120]);
		const model = fitEffortWeightModel(buildWeeklyPairs(weeks));
		expect(model.thresholdEffort).toBe(0);
	});
});

describe('predictDeltaKg', () => {
	it('predikerer ukentlig vektendring ved gitt effort', () => {
		const weeks = exactSeries(0.5, -0.002, [100, 300, 200, 400, 150, 350, 250, 50, 320, 180, 280, 120]);
		const model = fitEffortWeightModel(buildWeeklyPairs(weeks));
		expect(predictDeltaKg(model, 250)).toBeCloseTo(0, 2);
		expect(predictDeltaKg(model, 400)).toBeCloseTo(-0.3, 2);
		expect(predictDeltaKg(model, 0)).toBeCloseTo(0.5, 2);
	});

	it('returnerer null når modellen er for svak', () => {
		const points: WeeklyEffortWeightPoint[] = [];
		const model = fitEffortWeightModel(points);
		expect(predictDeltaKg(model, 200)).toBeNull();
	});
});
