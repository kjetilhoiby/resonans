import { describe, it, expect } from 'vitest';
import {
	packLinear,
	packSheets,
	computeMaterial,
	computeCutList,
	formatNok,
	formatMeters,
	type Material,
	type CutSpec
} from './calc';

function linearMaterial(partial: Partial<Material> & { cuts: CutSpec[] }): Material {
	return {
		id: 'm1',
		name: '48x48 furu',
		stockLengthMm: 3900,
		pricePerMeterNok: 54,
		...partial,
		kind: 'linear'
	};
}

function sheetMaterial(partial: Partial<Material> & { cuts: CutSpec[] }): Material {
	return {
		id: 'm2',
		name: '15mm kryssfiner',
		stockWidthMm: 2440,
		stockHeightMm: 1220,
		pricePerSheetNok: 300,
		...partial,
		kind: 'sheet'
	};
}

describe('packLinear', () => {
	it('pakker 5 biter på 1200 mm i 2 lekter på 3900 mm (3 per lekt)', () => {
		const res = packLinear([1200, 1200, 1200, 1200, 1200], 3900);
		expect(res.stock).toBe(2);
		expect(res.tooLong).toEqual([]);
	});

	it('kombinerer ulike lengder smart på samme lekt', () => {
		// 2000 + 1200 + 600 = 3800 ≤ 3900 → 1 lekt
		const res = packLinear([2000, 1200, 600], 3900);
		expect(res.stock).toBe(1);
		expect(res.wasteMm).toBeCloseTo(100);
	});

	it('flagger biter lengre enn lekten', () => {
		const res = packLinear([4200, 1200], 3900);
		expect(res.tooLong).toEqual([4200]);
		expect(res.stock).toBe(1);
	});

	it('trekker fra sagsnitt mellom biter', () => {
		expect(packLinear([1300, 1300, 1300], 3900, 0).stock).toBe(1);
		expect(packLinear([1300, 1300, 1300], 3900, 50).stock).toBe(2);
	});
});

describe('packSheets', () => {
	it('pakker mange små rektangler på én plate', () => {
		const rects = Array.from({ length: 6 }, () => ({ w: 380, h: 420 }));
		const res = packSheets(rects, 2440, 1220);
		expect(res.sheets).toBe(1);
		expect(res.tooLarge).toEqual([]);
	});

	it('trenger flere plater når arealet ikke får plass', () => {
		// To plater på nesten full størrelse → 2 plater
		const rects = [
			{ w: 2400, h: 1200 },
			{ w: 2400, h: 1200 }
		];
		const res = packSheets(rects, 2440, 1220);
		expect(res.sheets).toBe(2);
	});

	it('tillater rotasjon slik at et høyt kapp legges på tvers', () => {
		// 1200×600 passer rotert (600 høyt, 1200 bredt) på 2440×1220
		const res = packSheets([{ w: 1200, h: 600 }], 2440, 1220);
		expect(res.sheets).toBe(1);
	});

	it('flagger kapp som er for store for plata', () => {
		const res = packSheets([{ w: 3000, h: 1500 }], 2440, 1220);
		expect(res.tooLarge).toHaveLength(1);
		expect(res.sheets).toBe(0);
	});
});

describe('computeMaterial — linear', () => {
	it('regner ut eksempelet: 5 biter på 1200, 48x48 furu', () => {
		const mat = linearMaterial({ cuts: [{ id: 'c1', lengthMm: 1200, quantity: 5 }] });
		const res = computeMaterial(mat, 0);
		expect(res.kind).toBe('linear');
		expect(res.stockNeeded).toBe(2);
		expect(res.piecesPerStock).toBe(3);
		// Hele lekter × meterpris: 2 × 3,90 m × 54 = 421,2 kr
		expect(res.costNok).toBeCloseTo(421.2);
		expect(res.stockLabel).toBe('3,90 m');
		expect(res.tooBig).toEqual([]);
	});

	it('håndterer flere kapp i flere lengder på samme materiale', () => {
		const mat = linearMaterial({
			pricePerMeterNok: 50,
			cuts: [
				{ id: 'c1', lengthMm: 2000, quantity: 1 },
				{ id: 'c2', lengthMm: 1200, quantity: 1 },
				{ id: 'c3', lengthMm: 600, quantity: 1 }
			]
		});
		const res = computeMaterial(mat, 0);
		// 2000+1200+600 = 3800 ≤ 3900 → 1 lekt
		expect(res.stockNeeded).toBe(1);
		expect(res.costNok).toBeCloseTo(1 * 3.9 * 50);
	});
});

describe('computeMaterial — sheet', () => {
	it('regner ut plater og kostnad per plate', () => {
		const mat = sheetMaterial({
			pricePerSheetNok: 300,
			cuts: [{ id: 'c1', widthMm: 380, heightMm: 420, quantity: 6 }]
		});
		const res = computeMaterial(mat, 0);
		expect(res.kind).toBe('sheet');
		expect(res.stockNeeded).toBe(1);
		expect(res.costNok).toBe(300);
		expect(res.stockLabel).toBe('2440×1220 mm');
	});

	it('flagger kapp som er større enn plata', () => {
		const mat = sheetMaterial({ cuts: [{ id: 'c1', widthMm: 3000, heightMm: 1500, quantity: 1 }] });
		const res = computeMaterial(mat, 0);
		expect(res.tooBig).toEqual(['3000×1500 mm']);
	});
});

describe('computeCutList', () => {
	it('summerer kostnad på tvers av lengdevarer og plater', () => {
		const materials: Material[] = [
			linearMaterial({ id: 'a', cuts: [{ id: 'c1', lengthMm: 1200, quantity: 5 }] }),
			sheetMaterial({ id: 'b', pricePerSheetNok: 300, cuts: [{ id: 'c2', widthMm: 380, heightMm: 420, quantity: 6 }] })
		];
		const res = computeCutList(materials, 0);
		expect(res.materials).toHaveLength(2);
		expect(res.totalCostNok).toBeCloseTo(421.2 + 300);
		expect(res.hasErrors).toBe(false);
	});

	it('markerer hasErrors når et kapp er for stort', () => {
		const materials: Material[] = [
			sheetMaterial({ cuts: [{ id: 'c1', widthMm: 3000, heightMm: 1500, quantity: 1 }] })
		];
		const res = computeCutList(materials, 0);
		expect(res.hasErrors).toBe(true);
	});

	it('hopper over materialer uten gyldige kapp', () => {
		const materials: Material[] = [
			linearMaterial({ cuts: [{ id: 'c1', lengthMm: 0, quantity: 5 }] }),
			sheetMaterial({ cuts: [{ id: 'c2', widthMm: 380, heightMm: 0, quantity: 2 }] })
		];
		const res = computeCutList(materials, 0);
		expect(res.materials).toHaveLength(0);
		expect(res.totalCostNok).toBe(0);
	});
});

describe('formatNok / formatMeters', () => {
	it('formaterer kroner avrundet', () => {
		expect(formatNok(421.2)).toBe('421 kr');
	});
	it('formaterer mm til meter', () => {
		expect(formatMeters(3900)).toBe('3,90 m');
		expect(formatMeters(1200)).toBe('1,20 m');
	});
});
