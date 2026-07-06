/**
 * Effort→vekt-terskelmodell.
 *
 * Estimerer hvilket ukentlig effort-nivå som kreves for å holde/senke vekta med
 * normalt kosthold, fra historiske ukespar (vektendring, ukeseffort):
 *
 *   ΔW = a + b·E   (OLS lineær regresjon)
 *
 *  - Terskel E0 = −a/b, kun gyldig når b < 0 (mer effort → mer nedgang).
 *  - Intercept a ≈ ukentlig vektdrift ved null trening ("normal diett"-baselinen).
 *  - Kvalitet uttrykkes som bånd (insufficient/weak/ok/good) basert på antall uker
 *    og korrelasjon — ingen falsk presisjon.
 *
 * Ren modul uten DB-import: input bygges av kallere fra sensor_aggregates-rader.
 */

export interface WeeklyEffortWeightInput {
	weekKey: string; // '2026W23' — kronologisk sortert, eldst først
	weightAvg: number | null; // snittvekt for uka (kg), null hvis ingen veiinger
	weighInCount: number; // antall veiinger i uka
	effort: number; // weeklyEffort.total, 0 hvis ingen økter (reell hvileuke)
}

export interface WeeklyEffortWeightPoint {
	weekKey: string;
	effort: number;
	weightDeltaKg: number; // snittvekt(uke) − snittvekt(forrige uke)
}

export type ModelQuality = 'insufficient' | 'weak' | 'ok' | 'good';

export interface EffortWeightModel {
	slope: number;
	intercept: number;
	r: number; // Pearson-korrelasjon
	nWeeks: number;
	residualStd: number;
	thresholdEffort: number | null; // E0 = −a/b, null når modellen er for svak
	quality: ModelQuality;
	extrapolated: boolean; // terskelen ligger >25 % over maks observert effort
	/** x er trailing snitt-effort over så mange uker (1 = samme ukes effort). */
	windowWeeks: number;
}

const MIN_WEEKS = 6;
const OK_WEEKS = 8;
const GOOD_WEEKS = 12;
const MIN_ABS_R = 0.3;
const GOOD_ABS_R = 0.5;
const EXTRAPOLATION_FACTOR = 1.25;

/**
 * Bygger (effort, ΔW)-par av påfølgende uker. Vakter:
 *  - begge ukene i paret må ha ≥ minWeighIns veiinger (default 2)
 *  - hull i serien (uke uten vektdata) dropper paret, ikke hele serien
 *  - effort 0 er et gyldig datapunkt (reell hvileuke), ikke manglende data
 *
 * `effortWindowWeeks` > 1 gir x = trailing SNITT-effort over de siste L ukene
 * (inkl. inneværende) — fanger kumulativ/lag-effekt der vekten reagerer på
 * akkumulert belastning, ikke samme ukes. Krever kontinuerlig ukesserie
 * (hvileuker = 0), som buildEffortWeightInputs leverer.
 */
export function buildWeeklyPairs(
	weeks: WeeklyEffortWeightInput[],
	opts: { minWeighIns?: number; effortWindowWeeks?: number } = {}
): WeeklyEffortWeightPoint[] {
	const minWeighIns = opts.minWeighIns ?? 2;
	const windowWeeks = Math.max(1, Math.round(opts.effortWindowWeeks ?? 1));
	const out: WeeklyEffortWeightPoint[] = [];

	for (let i = Math.max(1, windowWeeks - 1); i < weeks.length; i++) {
		const prev = weeks[i - 1];
		const curr = weeks[i];
		if (prev.weightAvg == null || curr.weightAvg == null) continue;
		if (prev.weighInCount < minWeighIns || curr.weighInCount < minWeighIns) continue;

		let effortSum = 0;
		for (let j = i - windowWeeks + 1; j <= i; j++) effortSum += weeks[j].effort;

		out.push({
			weekKey: curr.weekKey,
			effort: Math.round((effortSum / windowWeeks) * 10) / 10,
			weightDeltaKg: Math.round((curr.weightAvg - prev.weightAvg) * 1000) / 1000
		});
	}

	return out;
}

export function fitEffortWeightModel(
	points: WeeklyEffortWeightPoint[],
	windowWeeks = 1
): EffortWeightModel {
	const n = points.length;
	const empty: EffortWeightModel = {
		slope: 0,
		intercept: 0,
		r: 0,
		nWeeks: n,
		residualStd: 0,
		thresholdEffort: null,
		quality: 'insufficient',
		extrapolated: false,
		windowWeeks
	};
	if (n < MIN_WEEKS) return empty;

	const xs = points.map((p) => p.effort);
	const ys = points.map((p) => p.weightDeltaKg);
	const meanX = mean(xs);
	const meanY = mean(ys);

	let sxx = 0;
	let sxy = 0;
	let syy = 0;
	for (let i = 0; i < n; i++) {
		const dx = xs[i] - meanX;
		const dy = ys[i] - meanY;
		sxx += dx * dx;
		sxy += dx * dy;
		syy += dy * dy;
	}

	// Ingen variasjon i effort (eller vekt) → ingenting å regressere på.
	if (sxx === 0 || syy === 0) return { ...empty, quality: 'weak' };

	const slope = sxy / sxx;
	const intercept = meanY - slope * meanX;
	const r = sxy / Math.sqrt(sxx * syy);

	let ssRes = 0;
	for (let i = 0; i < n; i++) {
		const resid = ys[i] - (intercept + slope * xs[i]);
		ssRes += resid * resid;
	}
	const residualStd = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;

	const base: EffortWeightModel = {
		slope,
		intercept,
		r: Math.round(r * 100) / 100,
		nWeeks: n,
		residualStd: Math.round(residualStd * 1000) / 1000,
		thresholdEffort: null,
		quality: 'weak',
		extrapolated: false,
		windowWeeks
	};

	// Terskelen krever negativ helning (mer effort → mer nedgang) og reell samvariasjon.
	if (slope >= 0 || Math.abs(r) < MIN_ABS_R) return base;

	const threshold = -intercept / slope;
	// Negativ terskel betyr at vekta faller selv uten trening — terskelen er da 0.
	const thresholdEffort = Math.max(0, Math.round(threshold));
	const maxObserved = Math.max(...xs);
	const extrapolated = thresholdEffort > EXTRAPOLATION_FACTOR * maxObserved;

	const quality: ModelQuality =
		n >= GOOD_WEEKS && Math.abs(r) >= GOOD_ABS_R ? 'good' : n >= OK_WEEKS ? 'ok' : 'weak';

	if (quality === 'weak') return base;

	return { ...base, thresholdEffort, quality, extrapolated };
}

/** Predikert ukentlig vektendring (kg) ved gitt ukeseffort. Null når modellen er for svak. */
export function predictDeltaKg(model: EffortWeightModel, effort: number): number | null {
	if (model.quality === 'insufficient' || model.quality === 'weak') return null;
	return Math.round((model.intercept + model.slope * effort) * 100) / 100;
}

export interface BestEffortWeightFit {
	model: EffortWeightModel;
	windowWeeks: number;
	pairs: WeeklyEffortWeightPoint[];
}

/**
 * Prøver flere trailing-vinduer (kumulativ/lag-effekt) og velger det med
 * sterkest korrelasjon; ved likhet vinner minst vindu (enklest forklaring).
 * Kvalitetstersklene er uendret — «beste av fem svake» forblir weak, så
 * vindu-skanningen kan ikke fabrikkere en terskel av støy.
 */
export function fitBestEffortWeightModel(
	weeks: WeeklyEffortWeightInput[],
	opts: { windows?: number[]; minWeighIns?: number } = {}
): BestEffortWeightFit {
	const windows = opts.windows ?? [1, 2, 3, 4, 6];

	let best: BestEffortWeightFit | null = null;
	for (const windowWeeks of windows) {
		const pairs = buildWeeklyPairs(weeks, { minWeighIns: opts.minWeighIns, effortWindowWeeks: windowWeeks });
		const model = fitEffortWeightModel(pairs, windowWeeks);
		if (best == null || Math.abs(model.r) > Math.abs(best.model.r)) {
			best = { model, windowWeeks, pairs };
		}
	}

	return best!;
}

function mean(values: number[]): number {
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}
