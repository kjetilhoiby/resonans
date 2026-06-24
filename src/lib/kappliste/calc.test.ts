import { describe, it, expect } from 'vitest';
import {
	packBoards,
	computeCutList,
	normalizeDimension,
	formatNok,
	formatMeters,
	type CutListRow
} from './calc';

function row(partial: Partial<CutListRow> & { dimension: string; lengthCm: number; quantity: number }): CutListRow {
	return { id: partial.id ?? crypto.randomUUID(), meterPriceNok: partial.meterPriceNok ?? 0, ...partial };
}

describe('normalizeDimension', () => {
	it('senker bokstaver, fjerner mellomrom og normaliserer gangetegn', () => {
		expect(normalizeDimension(' 48 X 48 ')).toBe('48x48');
		expect(normalizeDimension('28×120')).toBe('28x120');
		expect(normalizeDimension('73*48')).toBe('73x48');
	});
});

describe('packBoards', () => {
	it('pakker 5 biter på 120 cm i 2 fjøler på 390 cm (3 biter per fjøl)', () => {
		const res = packBoards([120, 120, 120, 120, 120], 390);
		expect(res.boards).toBe(2);
		expect(res.tooLong).toEqual([]);
	});

	it('pakker 3 biter på 120 i én fjøl, og 30 cm blir til overs', () => {
		const res = packBoards([120, 120, 120], 390);
		expect(res.boards).toBe(1);
		expect(res.wasteCm).toBeCloseTo(30);
	});

	it('kombinerer ulike lengder smart (FFD) på samme fjøl', () => {
		// 200 + 120 + 60 = 380 ≤ 390 → 1 fjøl
		const res = packBoards([200, 120, 60], 390);
		expect(res.boards).toBe(1);
		expect(res.wasteCm).toBeCloseTo(10);
	});

	it('flagger biter som er lengre enn fjølen', () => {
		const res = packBoards([420, 120], 390);
		expect(res.tooLong).toEqual([420]);
		// 120 får fortsatt plass på én fjøl
		expect(res.boards).toBe(1);
	});

	it('trekker fra sagsnitt mellom biter på samme fjøl', () => {
		// 3 × 130 = 390 passer uten kerf, men med 5 mm kerf (×2 snitt = 1 cm) går det ikke → 2 fjøler
		expect(packBoards([130, 130, 130], 390, 0).boards).toBe(1);
		expect(packBoards([130, 130, 130], 390, 5).boards).toBe(2);
	});
});

describe('computeCutList', () => {
	it('regner ut eksempelet: 5 biter på 120, dimensjon 48x48', () => {
		const rows = [row({ dimension: '48x48', lengthCm: 120, quantity: 5, meterPriceNok: 54 })];
		const result = computeCutList(rows, 390);

		expect(result.dimensions).toHaveLength(1);
		const dim = result.dimensions[0];
		expect(dim.dimension).toBe('48x48');
		expect(dim.pieces).toBe(5);
		expect(dim.boardsNeeded).toBe(2);
		expect(dim.piecesPerFullBoard).toBe(3);
		// Hele fjøler × meterpris: 2 × 3,90 m × 54 kr = 421,2 kr
		expect(dim.costNok).toBeCloseTo(421.2);
		expect(result.totalBoards).toBe(2);
		expect(result.totalCostNok).toBeCloseTo(421.2);
		expect(result.hasErrors).toBe(false);
	});

	it('grupperer rader med samme dimensjon og kombinerer biter på fjølene', () => {
		const rows = [
			row({ dimension: '48x48', lengthCm: 200, quantity: 1, meterPriceNok: 50 }),
			row({ dimension: '48x48', lengthCm: 120, quantity: 1, meterPriceNok: 50 }),
			row({ dimension: '48x48', lengthCm: 60, quantity: 1, meterPriceNok: 50 })
		];
		const result = computeCutList(rows, 390);
		expect(result.dimensions).toHaveLength(1);
		// 200 + 120 + 60 = 380 ≤ 390 → 1 fjøl
		expect(result.dimensions[0].boardsNeeded).toBe(1);
		expect(result.totalCostNok).toBeCloseTo(1 * 3.9 * 50);
	});

	it('holder ulike dimensjoner adskilt med hver sin kostnad', () => {
		const rows = [
			row({ dimension: '48x48', lengthCm: 120, quantity: 5, meterPriceNok: 54 }),
			row({ dimension: '73x48', lengthCm: 240, quantity: 2, meterPriceNok: 80 })
		];
		const result = computeCutList(rows, 390);
		expect(result.dimensions).toHaveLength(2);

		const byDim = Object.fromEntries(result.dimensions.map((d) => [d.dimension, d]));
		expect(byDim['48x48'].boardsNeeded).toBe(2); // 5×120
		expect(byDim['73x48'].boardsNeeded).toBe(2); // 240+240 = 480 > 390 → 2 fjøler
		expect(result.totalBoards).toBe(4);
		expect(result.totalCostNok).toBeCloseTo(2 * 3.9 * 54 + 2 * 3.9 * 80);
	});

	it('normaliserer skrivemåter slik at 48x48 og «48 X 48» grupperes sammen', () => {
		const rows = [
			row({ dimension: '48x48', lengthCm: 120, quantity: 3, meterPriceNok: 54 }),
			row({ dimension: '48 X 48', lengthCm: 120, quantity: 3, meterPriceNok: 54 })
		];
		const result = computeCutList(rows, 390);
		expect(result.dimensions).toHaveLength(1);
		expect(result.dimensions[0].pieces).toBe(6);
		expect(result.dimensions[0].boardsNeeded).toBe(2); // 6×120 → 2 fjøler (3 per fjøl)
	});

	it('flagger feil når en bit er lengre enn fjølen', () => {
		const rows = [row({ dimension: '48x48', lengthCm: 420, quantity: 1, meterPriceNok: 54 })];
		const result = computeCutList(rows, 390);
		expect(result.hasErrors).toBe(true);
		expect(result.dimensions[0].tooLong).toEqual([420]);
	});

	it('ignorerer rader uten dimensjon, lengde eller antall', () => {
		const rows = [
			row({ dimension: '', lengthCm: 120, quantity: 2, meterPriceNok: 54 }),
			row({ dimension: '48x48', lengthCm: 0, quantity: 2, meterPriceNok: 54 }),
			row({ dimension: '48x48', lengthCm: 120, quantity: 0, meterPriceNok: 54 })
		];
		const result = computeCutList(rows, 390);
		expect(result.dimensions).toHaveLength(0);
		expect(result.totalBoards).toBe(0);
		expect(result.totalCostNok).toBe(0);
	});

	it('faller tilbake til 390 cm fjøllengde ved ugyldig input', () => {
		const rows = [row({ dimension: '48x48', lengthCm: 120, quantity: 3, meterPriceNok: 54 })];
		const result = computeCutList(rows, 0);
		expect(result.boardLengthCm).toBe(390);
		expect(result.dimensions[0].boardsNeeded).toBe(1);
	});
});

describe('formatNok / formatMeters', () => {
	it('formaterer kroner avrundet til hele', () => {
		expect(formatNok(421.2)).toBe('421 kr');
		expect(formatNok(324)).toBe('324 kr');
	});

	it('formaterer lengder i meter med komma', () => {
		expect(formatMeters(390)).toBe('3,90 m');
		expect(formatMeters(120)).toBe('1,20 m');
	});
});
