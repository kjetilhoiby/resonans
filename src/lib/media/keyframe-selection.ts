/**
 * Innholdsbevisst keyframe-utvalg. Rene funksjoner — ingen DOM.
 *
 * Gitt tett samplede kandidat-frames (hver med en liten gråtone-signatur),
 * velger vi de mest informative framene i stedet for jevnt fordelte:
 *   - Finnes tydelige klipp (store hopp i signatur) → én representant per klipp.
 *   - Ellers (ett sammenhengende opptak) → «farthest-point»-utvalg som fanger
 *     de mest forskjellige framene (f.eks. bunn vs. topp i en pull-up).
 *
 * Signaturen er en flat gråtone-pikselliste (0..255) fra et lite canvas.
 * Selve samplingen (play-through + requestVideoFrameCallback) ligger i
 * `$lib/client/video-frames`; denne logikken er kamera-uavhengig og testbar.
 */

export interface FrameSample {
	timestampSec: number;
	signature: number[];
}

/** Gjennomsnittlig absolutt pikseldifferanse, normalisert til 0..1. */
export function frameDifference(a: number[], b: number[]): number {
	const n = Math.min(a.length, b.length);
	if (n === 0) return 0;
	let sum = 0;
	for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
	return sum / n / 255;
}

/** Differanse mellom påfølgende kandidater (lengde = samples.length − 1). */
export function consecutiveDiffs(samples: FrameSample[]): number[] {
	const diffs: number[] = [];
	for (let i = 1; i < samples.length; i++) {
		diffs.push(frameDifference(samples[i - 1].signature, samples[i].signature));
	}
	return diffs;
}

export interface CutOptions {
	/** Diff må minst være så stor (absolutt) for å regnes som klipp. */
	minAbsolute?: number;
	/** …og minst så mange ganger medianen (robust mot at spissen selv blåser opp
	 * snitt/standardavvik). */
	medianMultiple?: number;
}

/**
 * Indeksene (i samples) rett etter et klipp — der signaturen hopper kraftig.
 * Median-basert terskel, ikke snitt/std: en enkelt kraftig spiss ville ellers
 * blåst opp sitt eget standardavvik og gjemt seg.
 */
export function detectCutIndices(diffs: number[], { minAbsolute = 0.18, medianMultiple = 3 }: CutOptions = {}): number[] {
	if (diffs.length === 0) return [];
	const sorted = [...diffs].sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
	const cuts: number[] = [];
	for (let i = 0; i < diffs.length; i++) {
		if (diffs[i] >= minAbsolute && diffs[i] >= medianMultiple * median) cuts.push(i + 1);
	}
	return cuts;
}

/** Velg `count` elementer jevnt fordelt fra en liste. */
function evenlyPick<T>(arr: T[], count: number): T[] {
	if (count <= 0) return [];
	if (arr.length <= count) return [...arr];
	if (count === 1) return [arr[Math.floor(arr.length / 2)]];
	const out: T[] = [];
	for (let k = 0; k < count; k++) {
		out.push(arr[Math.round((k * (arr.length - 1)) / (count - 1))]);
	}
	return [...new Set(out)];
}

/**
 * «Farthest-point»-utvalg: seed med første og siste frame (temporal dekning),
 * legg så grådig til framen som er mest forskjellig fra de allerede valgte.
 */
export function farthestPointIndices(samples: FrameSample[], count: number): number[] {
	const n = samples.length;
	if (n <= count) return samples.map((_, i) => i);

	const selected = new Set<number>([0, n - 1]);
	while (selected.size < count) {
		let best = -1;
		let bestDist = -1;
		for (let i = 0; i < n; i++) {
			if (selected.has(i)) continue;
			let minD = Infinity;
			for (const s of selected) {
				minD = Math.min(minD, frameDifference(samples[i].signature, samples[s].signature));
			}
			if (minD > bestDist) {
				bestDist = minD;
				best = i;
			}
		}
		if (best < 0) break;
		selected.add(best);
	}
	return [...selected].sort((a, b) => a - b);
}

/**
 * Hybrid-utvalg: klipp-representanter hvis klipp finnes, ellers maks-diversitet.
 * Returnerer sorterte, unike indekser (≤ count).
 */
export function selectKeyframeIndices(samples: FrameSample[], count: number): number[] {
	const n = samples.length;
	if (n <= count) return samples.map((_, i) => i);

	const cuts = detectCutIndices(consecutiveDiffs(samples));
	if (cuts.length >= 1) {
		const boundaries = [0, ...cuts, n];
		const reps: number[] = [];
		for (let i = 0; i < boundaries.length - 1; i++) {
			reps.push(Math.floor((boundaries[i] + boundaries[i + 1] - 1) / 2));
		}
		if (reps.length >= count) return evenlyPick(reps, count);
		// Færre klipp enn ønsket → fyll på med diverse frames.
		const filled = new Set<number>(reps);
		for (const idx of farthestPointIndices(samples, count)) {
			if (filled.size >= count) break;
			filled.add(idx);
		}
		return [...filled].sort((a, b) => a - b).slice(0, count);
	}

	return farthestPointIndices(samples, count);
}

/** Som `selectKeyframeIndices`, men returnerer tidsstempler. */
export function selectKeyframeOffsets(samples: FrameSample[], count: number): number[] {
	return selectKeyframeIndices(samples, count).map((i) => samples[i].timestampSec);
}
