import { describe, it, expect } from 'vitest';
import {
	frameDifference,
	consecutiveDiffs,
	detectCutIndices,
	farthestPointIndices,
	selectKeyframeIndices,
	selectKeyframeOffsets,
	visualNovelty,
	fusedSaliency,
	selectSalientIndices,
	selectSalientOffsets,
	type FrameSample
} from './keyframe-selection';

const sample = (timestampSec: number, value: number): FrameSample => ({
	timestampSec,
	signature: [value, value, value, value]
});

describe('frameDifference', () => {
	it('er 0 for identiske signaturer', () => {
		expect(frameDifference([10, 20], [10, 20])).toBe(0);
	});
	it('er 1 for maksimal forskjell', () => {
		expect(frameDifference([0, 0], [255, 255])).toBe(1);
	});
	it('håndterer ulik lengde og tomme', () => {
		expect(frameDifference([], [1, 2])).toBe(0);
	});
});

describe('detectCutIndices', () => {
	it('finner en tydelig spiss', () => {
		expect(detectCutIndices([0.01, 0.01, 0.3, 0.01, 0.01])).toEqual([3]);
	});
	it('gir ingen kutt for en flat serie', () => {
		expect(detectCutIndices([0.02, 0.02, 0.02, 0.02])).toEqual([]);
	});
});

describe('consecutiveDiffs', () => {
	it('har lengde n-1', () => {
		expect(consecutiveDiffs([sample(0, 0), sample(1, 100), sample(2, 200)])).toHaveLength(2);
	});
});

describe('selectKeyframeIndices', () => {
	it('returnerer alle når det er færre enn ønsket', () => {
		const samples = [sample(0, 0), sample(1, 10), sample(2, 20)];
		expect(selectKeyframeIndices(samples, 6)).toEqual([0, 1, 2]);
	});

	it('velger representanter på hver side av et klipp', () => {
		// Fem mørke frames, så fem lyse — hardt kutt mellom indeks 4 og 5.
		const samples = [
			...Array.from({ length: 5 }, (_, i) => sample(i, 10)),
			...Array.from({ length: 5 }, (_, i) => sample(5 + i, 200))
		];
		const idx = selectKeyframeIndices(samples, 2);
		expect(idx).toHaveLength(2);
		expect(idx[0]).toBeLessThan(5); // fra første klipp
		expect(idx[1]).toBeGreaterThanOrEqual(5); // fra andre klipp
	});

	it('bruker diversitet (farthest-point) uten klipp, og dekker start+slutt', () => {
		// Jevn gradient — ingen kutt.
		const samples = Array.from({ length: 10 }, (_, i) => sample(i, i * 25));
		const idx = selectKeyframeIndices(samples, 3);
		expect(idx).toHaveLength(3);
		expect(idx).toContain(0);
		expect(idx).toContain(9);
	});
});

describe('farthestPointIndices', () => {
	it('seeder med første og siste', () => {
		const samples = Array.from({ length: 8 }, (_, i) => sample(i, i * 30));
		const idx = farthestPointIndices(samples, 4);
		expect(idx).toContain(0);
		expect(idx).toContain(7);
		expect(idx).toHaveLength(4);
	});
});

describe('selectKeyframeOffsets', () => {
	it('mapper valgte indekser til tidsstempler', () => {
		const samples = [sample(0.5, 0), sample(1.5, 10), sample(2.5, 20)];
		expect(selectKeyframeOffsets(samples, 6)).toEqual([0.5, 1.5, 2.5]);
	});
});

const withAudio = (timestampSec: number, value: number, audioEnergy: number): FrameSample => ({
	timestampSec,
	signature: [value, value, value, value],
	audioEnergy
});

describe('visualNovelty', () => {
	it('er høy ved endring, lav i rolige partier', () => {
		// to mørke, så to lyse — endringen ligger mellom indeks 1 og 2.
		const samples = [sample(0, 0), sample(1, 0), sample(2, 255), sample(3, 255)];
		const nov = visualNovelty(samples);
		expect(nov[1]).toBeGreaterThan(nov[0]);
		expect(nov[2]).toBeGreaterThan(nov[3]);
	});
});

describe('fusedSaliency', () => {
	it('uten lyd = normalisert bevegelse', () => {
		const samples = [sample(0, 0), sample(1, 0), sample(2, 255), sample(3, 255)];
		const s = fusedSaliency(samples);
		expect(Math.max(...s)).toBeCloseTo(1);
		expect(Math.min(...s)).toBeCloseTo(0);
	});

	it('vekter inn lyd-energi når den finnes', () => {
		// Identiske signaturer (ingen bevegelse) → saliens styres av lyd.
		const samples = [
			withAudio(0, 100, 0),
			withAudio(1, 100, 10),
			withAudio(2, 100, 0),
			withAudio(3, 100, 0)
		];
		const s = fusedSaliency(samples);
		expect(s.indexOf(Math.max(...s))).toBe(1);
	});
});

describe('selectSalientIndices', () => {
	it('returnerer alle når det er færre enn ønsket', () => {
		const samples = [sample(0, 0), sample(1, 10), sample(2, 20)];
		expect(selectSalientIndices(samples, 6)).toEqual([0, 1, 2]);
	});

	it('velger mest fremtredende frame per tids-bin (én per bin)', () => {
		// 12 identiske signaturer; lyd-topper i indeks 1, 5, 10 (én per bin).
		const samples = Array.from({ length: 12 }, (_, i) =>
			withAudio(i, 100, i === 1 || i === 5 || i === 10 ? 10 : 0)
		);
		expect(selectSalientIndices(samples, 3)).toEqual([1, 5, 10]);
	});

	it('gir temporal spredning', () => {
		const samples = Array.from({ length: 12 }, (_, i) => sample(i, i * 20));
		const idx = selectSalientIndices(samples, 3);
		expect(idx).toHaveLength(3);
		expect(idx[0]).toBeLessThan(4);
		expect(idx[2]).toBeGreaterThanOrEqual(8);
	});
});

describe('selectSalientOffsets', () => {
	it('mapper til tidsstempler', () => {
		const samples = Array.from({ length: 12 }, (_, i) =>
			withAudio(i * 0.5, 100, i === 1 || i === 5 || i === 10 ? 10 : 0)
		);
		expect(selectSalientOffsets(samples, 3)).toEqual([0.5, 2.5, 5]);
	});
});
