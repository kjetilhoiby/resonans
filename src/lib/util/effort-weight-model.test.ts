import { describe, it, expect } from 'vitest';
import {
	binEffortWeight,
	buildWeeklyPairs,
	fitBestEffortWeightModel,
	fitEffortWeightModel,
	predictDeltaKg,
	thresholdFromBins,
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

describe('buildWeeklyPairs med effort-vindu', () => {
	it('x blir trailing snitt over L uker', () => {
		const weeks = [week(1, 90, 300), week(2, 90, 0), week(3, 90, 150)];
		const pairs = buildWeeklyPairs(weeks, { effortWindowWeeks: 3 });
		expect(pairs).toEqual([{ weekKey: '2026W03', effort: 150, weightDeltaKg: 0 }]);
	});
});

describe('fitBestEffortWeightModel (lag/kumulativ effekt)', () => {
	/** Serie der ΔW følger 3-ukers snitt-effort: ΔW_i = 0.5 − 0.002·snitt(E_{i−2..i}). */
	function laggedSeries(efforts: number[], startWeight = 90): WeeklyEffortWeightInput[] {
		const weeks: WeeklyEffortWeightInput[] = [];
		let w = startWeight;
		efforts.forEach((e, i) => {
			if (i >= 2) {
				const avg = (efforts[i] + efforts[i - 1] + efforts[i - 2]) / 3;
				w += 0.5 - 0.002 * avg;
			}
			weeks.push(week(i + 1, w, e));
		});
		return weeks;
	}

	it('finner lag-vinduet (L=3) og gjenfinner terskelen 250', () => {
		const efforts = [100, 300, 200, 400, 150, 350, 250, 50, 320, 180, 280, 120, 220, 380, 90, 310];
		const { model, windowWeeks } = fitBestEffortWeightModel(laggedSeries(efforts));
		expect(windowWeeks).toBe(3);
		expect(model.windowWeeks).toBe(3);
		expect(model.thresholdEffort).not.toBeNull();
		expect(model.thresholdEffort!).toBeGreaterThan(250 * 0.9);
		expect(model.thresholdEffort!).toBeLessThan(250 * 1.1);
	});

	it('velger L=1 når effekten er umiddelbar (ingen lag)', () => {
		const weeks = exactSeries(0.5, -0.002, [100, 300, 200, 400, 150, 350, 250, 50, 320, 180, 280, 120]);
		const { windowWeeks, model } = fitBestEffortWeightModel(weeks);
		expect(windowWeeks).toBe(1);
		expect(model.thresholdEffort).toBe(250);
	});

	it('ren støy forblir weak selv etter vindu-skanning', () => {
		// Vekt flat, effort varierer — ingen sammenheng i noe vindu
		const weeks = [0, 100, 300, 50, 250, 150, 350, 200, 80, 270, 130, 310].map((e, i) =>
			week(i + 1, 90 + NOISE[i % NOISE.length], e)
		);
		const { model } = fitBestEffortWeightModel(weeks);
		expect(model.quality).toBe('weak');
		expect(model.thresholdEffort).toBeNull();
	});
});

describe('binnet analyse (terskel-aktige mønstre)', () => {
	/**
	 * Terskel-data: under effort 200 er ΔW ren støy rundt +0.05; over 200 er
	 * snittet −0.3. Lineær OLS blir svak (skyen dominerer), men bins fanger det.
	 */
	function thresholdSeries(count: number): WeeklyEffortWeightInput[] {
		const weeks: WeeklyEffortWeightInput[] = [];
		let w = 90;
		for (let i = 0; i < count; i++) {
			// 3 av 4 uker lav effort (50–190), hver 4. uke høy (220–380)
			const high = i % 4 === 3;
			const effort = high ? 220 + (i * 37) % 160 : 50 + (i * 53) % 140;
			const noise = NOISE[i % NOISE.length] * 3; // ±0.27 støy
			const delta = high ? -0.3 + noise : 0.05 + noise;
			w += delta;
			weeks.push(week(i + 1, w, effort));
		}
		return weeks;
	}

	it('binEffortWeight deler i kvantil-bins med likt antall uker', () => {
		const pairs = buildWeeklyPairs(thresholdSeries(60));
		const bins = binEffortWeight(pairs, { binCount: 5, minPerBin: 8 });
		expect(bins).toHaveLength(5);
		const total = bins.reduce((s, b) => s + b.nWeeks, 0);
		expect(total).toBe(pairs.length);
		// Sortert på effort
		for (let i = 1; i < bins.length; i++) {
			expect(bins[i].meanEffort).toBeGreaterThanOrEqual(bins[i - 1].meanEffort);
		}
	});

	it('bins redder terskelen når lineær r er svak: stor støysky + tydelig negativ topp', () => {
		// 100 lav-effort-uker med ren støy (±0.64), 15 høy-effort-uker med snitt −0.35.
		// Kalibrert til lineær r ≈ −0.2 (weak) — men topp-binnet er klart negativt.
		const pairs: WeeklyEffortWeightPoint[] = [];
		for (let i = 0; i < 100; i++) {
			pairs.push({ weekKey: `c${i}`, effort: 40 + ((i * 47) % 180), weightDeltaKg: NOISE[i % NOISE.length] * 8 });
		}
		for (let i = 0; i < 15; i++) {
			pairs.push({ weekKey: `h${i}`, effort: 240 + ((i * 37) % 140), weightDeltaKg: -0.35 + NOISE[i % NOISE.length] * 2 });
		}

		const model = fitEffortWeightModel(pairs);
		expect(model.quality).toBe('weak'); // OLS ser ikke mønsteret

		const bins = binEffortWeight(pairs);
		const binThreshold = thresholdFromBins(bins);
		expect(binThreshold).not.toBeNull(); // ...men bins gjør det
		expect(binThreshold!.thresholdEffort).toBeGreaterThan(100);
		expect(binThreshold!.thresholdEffort).toBeLessThan(280);
		expect(binThreshold!.topBinMeanDeltaKg).toBeLessThan(-0.1);
		expect(binThreshold!.topBinShareNegative).toBeGreaterThanOrEqual(0.6);
	});

	it('fitBest: kilden er konsistent — regresjon krever ok/good, bins krever bin-terskel', () => {
		const fit = fitBestEffortWeightModel(thresholdSeries(80));
		expect(fit.effectiveThreshold).not.toBeNull();
		if (fit.thresholdSource === 'regresjon') {
			expect(['ok', 'good']).toContain(fit.model.quality);
			expect(fit.effectiveThreshold).toBe(fit.model.thresholdEffort);
		} else {
			expect(fit.thresholdSource).toBe('bins');
			expect(fit.effectiveThreshold).toBe(fit.binThreshold!.thresholdEffort);
		}
	});

	it('ren støy gir ingen bin-terskel', () => {
		const weeks = Array.from({ length: 60 }, (_, i) =>
			week(i + 1, 90 + NOISE[i % NOISE.length], 50 + ((i * 53) % 300))
		);
		const fit = fitBestEffortWeightModel(weeks);
		expect(fit.binThreshold).toBeNull();
		expect(fit.thresholdSource).toBeNull();
	});

	it('for få uker per bin gir tom bin-liste', () => {
		const pairs = buildWeeklyPairs(thresholdSeries(20));
		expect(binEffortWeight(pairs, { binCount: 5, minPerBin: 8 })).toEqual([]);
		expect(thresholdFromBins([])).toBeNull();
	});

	it('lineær sammenheng: OLS-terskelen vinner som kilde (regresjon)', () => {
		const efforts = Array.from({ length: 60 }, (_, i) => 50 + ((i * 53) % 350));
		const weeks = exactSeries(0.5, -0.002, efforts);
		const fit = fitBestEffortWeightModel(weeks);
		expect(fit.thresholdSource).toBe('regresjon');
		expect(fit.effectiveThreshold).toBe(250);
		// Bin-terskelen finnes også og ligger i nærheten
		expect(fit.binThreshold).not.toBeNull();
		expect(Math.abs(fit.binThreshold!.thresholdEffort - 250)).toBeLessThan(60);
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
