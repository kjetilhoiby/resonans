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
	/**
	 * Om vi i det hele tatt HAR øktdata for uka.
	 *
	 * `effort: 0` betyr «trente ikke». Det er noe helt annet enn «vi vet ikke hva
	 * du trente», og forskjellen var usynlig så lenge vekt- og økthistorikken
	 * startet samtidig. HealthKit-backfillen brøt det: vekt går nå tilbake til
	 * 2014, mens `canonical_workouts` begynner der den første øktkilden begynte.
	 * Uten dette flagget blir hver uke i mellomrommet et regresjonspunkt som sier
	 * «stort vekttap ved null trening» — og modellen konkluderer med at trening
	 * ikke betyr noe.
	 *
	 * Valgfri: uten den antas true, som er riktig for alle kallere som bygger
	 * ukelista fra en periode der øktdata finnes.
	 */
	effortKnown?: boolean;
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

		// Hele effort-vinduet må ha kjent øktdata. Én ukjent uke inne i vinduet gjør
		// snittet for lavt, og et for lavt effort-tall parret med et ekte vekttap er
		// nettopp punktet som trekker stigningstallet mot null.
		let effortSum = 0;
		let effortKnown = true;
		for (let j = i - windowWeeks + 1; j <= i; j++) {
			if (weeks[j].effortKnown === false) effortKnown = false;
			effortSum += weeks[j].effort;
		}
		if (!effortKnown) continue;

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

// ─── Binnet analyse ──────────────────────────────────────────────────────────
// Lineær OLS drukner terskel-aktige mønstre: en stor masse støyete
// lav-effort-uker dominerer selv om høy-effort-ukene konsekvent går ned.
// Kvantil-bins viser snitt-ΔW per effort-nivå og utleder terskelen fra
// null-krysningen — robust og lett å lese.

export interface EffortBin {
	effortMin: number;
	effortMax: number;
	meanEffort: number;
	meanDeltaKg: number;
	nWeeks: number;
	/** Andel av ukene i binnet med vektnedgang (ΔW < 0). */
	shareNegative: number;
}

export interface BinThreshold {
	thresholdEffort: number;
	topBinMeanDeltaKg: number;
	topBinShareNegative: number;
}

/** Deler parene i kvantil-bins (likt antall uker per bin) langs effort-aksen. */
export function binEffortWeight(
	points: WeeklyEffortWeightPoint[],
	opts: { binCount?: number; minPerBin?: number } = {}
): EffortBin[] {
	const binCount = opts.binCount ?? 5;
	const minPerBin = opts.minPerBin ?? 8;
	if (points.length < binCount * minPerBin) return [];

	const sorted = [...points].sort((a, b) => a.effort - b.effort);
	const bins: EffortBin[] = [];
	for (let b = 0; b < binCount; b++) {
		const start = Math.floor((b * sorted.length) / binCount);
		const end = Math.floor(((b + 1) * sorted.length) / binCount);
		const slice = sorted.slice(start, end);
		if (slice.length === 0) continue;
		const meanEffort = slice.reduce((s, p) => s + p.effort, 0) / slice.length;
		const meanDelta = slice.reduce((s, p) => s + p.weightDeltaKg, 0) / slice.length;
		const negative = slice.filter((p) => p.weightDeltaKg < 0).length;
		bins.push({
			effortMin: Math.round(slice[0].effort),
			effortMax: Math.round(slice[slice.length - 1].effort),
			meanEffort: Math.round(meanEffort),
			meanDeltaKg: Math.round(meanDelta * 1000) / 1000,
			nWeeks: slice.length,
			shareNegative: Math.round((negative / slice.length) * 100) / 100
		});
	}
	return bins;
}

const BIN_TOP_MIN_LOSS = -0.1; // øverste bin må vise reell nedgang (kg/uke)
const BIN_TOP_MIN_SHARE_NEGATIVE = 0.6;
const BIN_MIN_SPREAD = 0.15; // øverste bin må ligge så mye under nederste

/**
 * Terskel fra bin-snittene: der snitt-ΔW krysser null på vei ned (lineær
 * interpolasjon på effort-aksen). Vakter sørger for at støy ikke gir terskel:
 * øverste bin må vise reell, konsistent nedgang og ligge klart under nederste.
 */
export function thresholdFromBins(bins: EffortBin[]): BinThreshold | null {
	if (bins.length < 3) return null;
	const first = bins[0];
	const last = bins[bins.length - 1];
	if (last.meanDeltaKg > BIN_TOP_MIN_LOSS) return null;
	if (last.shareNegative < BIN_TOP_MIN_SHARE_NEGATIVE) return null;
	if (first.meanDeltaKg - last.meanDeltaKg < BIN_MIN_SPREAD) return null;

	// Finn siste null-krysning fra + til − (mest konservative terskel)
	let threshold: number | null = null;
	for (let i = 0; i < bins.length - 1; i++) {
		const a = bins[i];
		const b = bins[i + 1];
		if (a.meanDeltaKg > 0 && b.meanDeltaKg <= 0) {
			const t = a.meanDeltaKg / (a.meanDeltaKg - b.meanDeltaKg);
			threshold = a.meanEffort + t * (b.meanEffort - a.meanEffort);
		}
	}
	// Alle bins negative → vekta faller allerede på laveste nivå
	if (threshold == null) {
		threshold = first.meanDeltaKg <= 0 ? first.meanEffort : null;
	}
	if (threshold == null) return null;

	return {
		thresholdEffort: Math.round(threshold),
		topBinMeanDeltaKg: last.meanDeltaKg,
		topBinShareNegative: last.shareNegative
	};
}

export interface BestEffortWeightFit {
	model: EffortWeightModel;
	windowWeeks: number;
	pairs: WeeklyEffortWeightPoint[];
	bins: EffortBin[];
	binThreshold: BinThreshold | null;
	/** Effektiv terskel: OLS når ok/good, ellers bins når vaktene slipper den gjennom. */
	effectiveThreshold: number | null;
	thresholdSource: 'regresjon' | 'bins' | null;
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

	let best: { model: EffortWeightModel; windowWeeks: number; pairs: WeeklyEffortWeightPoint[] } | null = null;
	for (const windowWeeks of windows) {
		const pairs = buildWeeklyPairs(weeks, { minWeighIns: opts.minWeighIns, effortWindowWeeks: windowWeeks });
		const model = fitEffortWeightModel(pairs, windowWeeks);
		if (best == null || Math.abs(model.r) > Math.abs(best.model.r)) {
			best = { model, windowWeeks, pairs };
		}
	}

	const { model, windowWeeks, pairs } = best!;
	const bins = binEffortWeight(pairs);
	const binThreshold = thresholdFromBins(bins);

	const olsUsable = (model.quality === 'ok' || model.quality === 'good') && model.thresholdEffort != null;
	const effectiveThreshold = olsUsable ? model.thresholdEffort : (binThreshold?.thresholdEffort ?? null);
	const thresholdSource: BestEffortWeightFit['thresholdSource'] = olsUsable
		? 'regresjon'
		: binThreshold != null
			? 'bins'
			: null;

	return { model, windowWeeks, pairs, bins, binThreshold, effectiveThreshold, thresholdSource };
}

function mean(values: number[]): number {
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}
