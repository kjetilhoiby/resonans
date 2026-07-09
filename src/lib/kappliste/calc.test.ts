import { describe, it, expect } from 'vitest';
import {
	packLinear,
	packSheets,
	layoutLinear,
	layoutSheets,
	layoutSheetsGuillotine,
	countGuillotineCuts,
	guillotineCutLines,
	computeMaterial,
	computeCutList,
	formatNok,
	formatMeters,
	type Material,
	type CutSpec,
	type SheetPlacement
} from './calc';

/** Kan kappene på én plate frigjøres med rette gjennomgående (guillotine-)snitt? */
function isGuillotineCuttable(placements: SheetPlacement[], tol = 0.5): boolean {
	if (placements.length <= 1) return true;
	for (const axis of ['v', 'h'] as const) {
		const edges = [...new Set(placements.map((p) => (axis === 'v' ? p.x + p.w : p.y + p.h)))];
		for (const cut of edges) {
			const before: SheetPlacement[] = [];
			const after: SheetPlacement[] = [];
			let straddle = false;
			for (const p of placements) {
				const lo = axis === 'v' ? p.x : p.y;
				const hi = axis === 'v' ? p.x + p.w : p.y + p.h;
				if (hi <= cut + tol) before.push(p);
				else if (lo >= cut - tol) after.push(p);
				else {
					straddle = true;
					break;
				}
			}
			if (straddle || before.length === 0 || after.length === 0) continue;
			if (isGuillotineCuttable(before, tol) && isGuillotineCuttable(after, tol)) return true;
		}
	}
	return false;
}

function overlaps(a: SheetPlacement, b: SheetPlacement): boolean {
	return a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
}

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
		pricePerSquareMeterNok: 100,
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

	it('kombinerer høye og lave kapp på én plate (rest-soner)', () => {
		// 3×(1200×600) stående = 1800 bred stripe, 640×1220 til overs.
		// 6×(400×300) får plass som to kolonner × tre rader i stripa → 1 plate.
		const rects = [
			...Array.from({ length: 3 }, () => ({ w: 1200, h: 600 })),
			...Array.from({ length: 6 }, () => ({ w: 400, h: 300 }))
		];
		const res = packSheets(rects, 2440, 1220);
		expect(res.sheets).toBe(1);
		expect(res.tooLarge).toEqual([]);
	});

	it('underestimerer aldri: alle kapp plasseres innenfor en plate', () => {
		const rects = [
			{ w: 1200, h: 600 },
			{ w: 1200, h: 600 },
			{ w: 800, h: 400 },
			{ w: 380, h: 420 }
		];
		const { sheets } = layoutSheets(rects, 2440, 1220);
		const placed = sheets.flatMap((s) => s.placements);
		expect(placed).toHaveLength(rects.length);
		for (const p of placed) {
			expect(p.x + p.w).toBeLessThanOrEqual(2440 + 1e-6);
			expect(p.y + p.h).toBeLessThanOrEqual(1220 + 1e-6);
			expect(p.x).toBeGreaterThanOrEqual(-1e-6);
			expect(p.y).toBeGreaterThanOrEqual(-1e-6);
		}
	});
});

describe('layoutSheetsGuillotine', () => {
	it('plasserer alle kapp innenfor plata uten overlapp', () => {
		// Kappene fra skjermbildet (12 mm kryssfiner poppel, 1200×600 plate).
		const rects = [
			{ w: 474, h: 262 },
			{ w: 262, h: 62 },
			{ w: 262, h: 62 },
			{ w: 474, h: 62 },
			{ w: 224, h: 312 },
			{ w: 224, h: 112 },
			{ w: 224, h: 112 },
			{ w: 312, h: 112 }
		];
		const { sheets, tooLarge } = layoutSheetsGuillotine(rects, 1200, 600);
		expect(tooLarge).toEqual([]);
		const placed = sheets.flatMap((s) => s.placements);
		expect(placed).toHaveLength(rects.length);
		for (const p of placed) {
			expect(p.x).toBeGreaterThanOrEqual(-1e-6);
			expect(p.y).toBeGreaterThanOrEqual(-1e-6);
			expect(p.x + p.w).toBeLessThanOrEqual(1200 + 1e-6);
			expect(p.y + p.h).toBeLessThanOrEqual(600 + 1e-6);
		}
		for (const s of sheets) {
			for (let i = 0; i < s.placements.length; i++)
				for (let j = i + 1; j < s.placements.length; j++)
					expect(overlaps(s.placements[i], s.placements[j])).toBe(false);
		}
	});

	it('gir en layout som faktisk kan sages med rette gjennomgående snitt', () => {
		const rects = [
			{ w: 474, h: 262 },
			{ w: 262, h: 62 },
			{ w: 474, h: 62 },
			{ w: 224, h: 312 },
			{ w: 224, h: 112 },
			{ w: 312, h: 112 }
		];
		const { sheets } = layoutSheetsGuillotine(rects, 1200, 600, 1.8);
		for (const s of sheets) expect(isGuillotineCuttable(s.placements)).toBe(true);
	});

	it('tillater rotasjon slik at et høyt kapp legges på tvers', () => {
		const { sheets } = layoutSheetsGuillotine([{ w: 1200, h: 600 }], 2440, 1220);
		expect(sheets).toHaveLength(1);
	});

	it('flagger kapp som er for store for plata', () => {
		const { sheets, tooLarge } = layoutSheetsGuillotine([{ w: 3000, h: 1500 }], 2440, 1220);
		expect(sheets).toHaveLength(0);
		expect(tooLarge).toHaveLength(1);
	});
});

describe('countGuillotineCuts', () => {
	it('gir 0 snitt når kappet fyller hele plata', () => {
		const sheets = [{ placements: [{ x: 0, y: 0, w: 1200, h: 600 }] }];
		expect(countGuillotineCuts(sheets, 1200, 600)).toBe(0);
	});

	it('gir 2 snitt for ett kapp mindre enn plata i begge retninger', () => {
		const sheets = [{ placements: [{ x: 0, y: 0, w: 800, h: 400 }] }];
		expect(countGuillotineCuts(sheets, 1200, 600)).toBe(2);
	});

	it('gir 1 snitt for ett kapp i full bredde men lavere', () => {
		const sheets = [{ placements: [{ x: 0, y: 0, w: 1200, h: 400 }] }];
		expect(countGuillotineCuts(sheets, 1200, 600)).toBe(1);
	});

	it('gir 1 snitt for to kapp side ved side i full høyde uten svinn', () => {
		const sheets = [
			{
				placements: [
					{ x: 0, y: 0, w: 600, h: 600 },
					{ x: 600, y: 0, w: 600, h: 600 }
				]
			}
		];
		expect(countGuillotineCuts(sheets, 1200, 600)).toBe(1);
	});
});

describe('guillotineCutLines', () => {
	it('gir like mange linjer som countGuillotineCuts, alle rette og innenfor plata', () => {
		const rects = [
			{ w: 474, h: 262 },
			{ w: 262, h: 62 },
			{ w: 474, h: 62 },
			{ w: 224, h: 312 },
			{ w: 224, h: 112 },
			{ w: 312, h: 112 }
		];
		const { sheets } = layoutSheetsGuillotine(rects, 1200, 600, 1.8);
		let total = 0;
		for (const s of sheets) {
			const lines = guillotineCutLines(s.placements, 1200, 600, 1.8);
			total += lines.length;
			for (const l of lines) {
				// Rett linje: enten loddrett (x1==x2) eller vannrett (y1==y2).
				if (l.orientation === 'v') expect(l.x1).toBeCloseTo(l.x2);
				else expect(l.y1).toBeCloseTo(l.y2);
				expect(l.x1).toBeGreaterThanOrEqual(-1e-6);
				expect(l.y1).toBeGreaterThanOrEqual(-1e-6);
				expect(Math.max(l.x1, l.x2)).toBeLessThanOrEqual(1200 + 1e-6);
				expect(Math.max(l.y1, l.y2)).toBeLessThanOrEqual(600 + 1e-6);
			}
		}
		expect(total).toBe(countGuillotineCuts(sheets, 1200, 600, 1.8));
	});
});

describe('layoutLinear', () => {
	it('plasserer kappene på lektene (3+2) og oppgir svinn per lekt', () => {
		const { boards } = layoutLinear([1200, 1200, 1200, 1200, 1200], 3900);
		expect(boards).toHaveLength(2);
		expect(boards[0].pieces).toEqual([1200, 1200, 1200]);
		expect(boards[0].wasteMm).toBeCloseTo(300);
		expect(boards[1].pieces).toEqual([1200, 1200]);
	});
});

describe('layoutSheets', () => {
	it('gir koordinater for hvert kapp på plata, alle innenfor plata', () => {
		const { sheets } = layoutSheets(
			[
				{ w: 380, h: 420 },
				{ w: 380, h: 420 }
			],
			2440,
			1220
		);
		expect(sheets).toHaveLength(1);
		const placements = sheets[0].placements;
		expect(placements).toHaveLength(2);
		for (const p of placements) {
			expect(p.x + p.w).toBeLessThanOrEqual(2440 + 1e-6);
			expect(p.y + p.h).toBeLessThanOrEqual(1220 + 1e-6);
		}
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
	it('regner ut plater og kostnad per m² (hele plater × areal × pris/m²)', () => {
		const mat = sheetMaterial({
			pricePerSquareMeterNok: 100,
			cuts: [{ id: 'c1', widthMm: 380, heightMm: 420, quantity: 6 }]
		});
		const res = computeMaterial(mat, 0);
		expect(res.kind).toBe('sheet');
		expect(res.stockNeeded).toBe(1);
		// 1 plate × (2,44 × 1,22 = 2,9768 m²) × 100 kr/m² = 297,68 kr
		expect(res.costNok).toBeCloseTo(297.68);
		expect(res.stockLabel).toBe('2440×1220 mm');
	});

	it('flagger kapp som er større enn plata', () => {
		const mat = sheetMaterial({ cuts: [{ id: 'c1', widthMm: 3000, heightMm: 1500, quantity: 1 }] });
		const res = computeMaterial(mat, 0);
		expect(res.tooBig).toEqual(['3000×1500 mm']);
	});

	it('setter cutCount og guillotine-layout når guillotine er på', () => {
		const mat = sheetMaterial({
			pricePerSquareMeterNok: 100,
			cuts: [{ id: 'c1', widthMm: 380, heightMm: 420, quantity: 6 }]
		});
		const plain = computeMaterial(mat, 1.8, false);
		expect(plain.cutCount).toBeUndefined();
		const guillo = computeMaterial(mat, 1.8, true);
		expect(guillo.cutCount).toBeGreaterThan(0);
		expect(guillo.layout.kind).toBe('sheet');
	});
});

describe('computeCutList', () => {
	it('summerer kostnad på tvers av lengdevarer og plater', () => {
		const materials: Material[] = [
			linearMaterial({ id: 'a', cuts: [{ id: 'c1', lengthMm: 1200, quantity: 5 }] }),
			sheetMaterial({ id: 'b', pricePerSquareMeterNok: 100, cuts: [{ id: 'c2', widthMm: 380, heightMm: 420, quantity: 6 }] })
		];
		const res = computeCutList(materials, 0);
		expect(res.materials).toHaveLength(2);
		// lengdevare 421,2 kr + plate 297,68 kr
		expect(res.totalCostNok).toBeCloseTo(421.2 + 297.68);
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
