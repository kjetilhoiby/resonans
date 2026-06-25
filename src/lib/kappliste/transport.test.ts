import { describe, it, expect } from 'vitest';
import {
	fitsTransport,
	planSheetTransport,
	planBoardTransport,
	planMaterialTransport,
	MODEL_Y_TRANSPORT,
	type TransportLimit
} from './transport';
import { computeMaterial, type Material } from './calc';

const MY = MODEL_Y_TRANSPORT; // 1900 × 1000

describe('fitsTransport', () => {
	it('en stående 600×1200-bit passer Model Y', () => {
		expect(fitsTransport(600, 1200, MY)).toBe(true);
	});
	it('1200×600 passer (rotasjon)', () => {
		expect(fitsTransport(1200, 600, MY)).toBe(true);
	});
	it('en stripe på 600×1220 passer (lang side 1220 ≤ 1900)', () => {
		expect(fitsTransport(600, 1220, MY)).toBe(true);
	});
	it('et panel der begge sider er > 1000 passer ikke (1220×1220)', () => {
		expect(fitsTransport(1220, 1220, MY)).toBe(false);
	});
	it('hel plate 2440×1220 passer ikke', () => {
		expect(fitsTransport(2440, 1220, MY)).toBe(false);
	});
});

describe('planSheetTransport', () => {
	it('deler en tom hel plate i paneler som alle passer', () => {
		const plan = planSheetTransport([], 2440, 1220, MY);
		expect(plan.cuts).toBeGreaterThan(0);
		expect(plan.allFit).toBe(true);
		expect(plan.panels.every((p) => fitsTransport(p.w, p.h, MY))).toBe(true);
	});

	it('kapper langs mellomrom mellom stående bord (ingen bit deles)', () => {
		// Tre stående 600×1200 + restsone — vertikale snitt i mellomrommene gir striper som passer.
		const placements = [
			{ x: 0, y: 0, w: 600, h: 1200 },
			{ x: 600, y: 0, w: 600, h: 1200 },
			{ x: 1200, y: 0, w: 600, h: 1200 }
		];
		const plan = planSheetTransport(placements, 2440, 1220, MY);
		expect(plan.allFit).toBe(true);
		// Ingen panel skal kappe gjennom en bit: hvert panel inneholder hele bord.
		for (const p of placements) {
			const panel = plan.panels.find((pa) => p.x >= pa.x - 1e-6 && p.x + p.w <= pa.x + pa.w + 1e-6);
			expect(panel).toBeDefined();
		}
	});

	it('flagger panel som ikke passer når en bit selv er for stor', () => {
		// En 1100×1100-bit: min side 1100 > 1000 → passer ikke bilen, og snitt kan ikke dele den.
		const plan = planSheetTransport([{ x: 0, y: 0, w: 1100, h: 1100 }], 2440, 1220, MY);
		expect(plan.allFit).toBe(false);
	});
});

describe('planBoardTransport', () => {
	it('deler en 3,90 m lekt med 3×1200 i transport-lengder (≤1900)', () => {
		const plan = planBoardTransport([1200, 1200, 1200], MY);
		expect(plan.segments).toHaveLength(3); // 1200 alene per segment (2×1200=2400 > 1900)
		expect(plan.cuts).toBe(2);
		expect(plan.allFit).toBe(true);
	});

	it('pakker korte biter sammen i samme transport-lengde', () => {
		const plan = planBoardTransport([900, 900, 900], MY); // 900+900=1800 ≤ 1900, +900 ny
		expect(plan.segments).toEqual([[900, 900], [900]]);
		expect(plan.cuts).toBe(1);
	});

	it('flagger en bit som er lengre enn bilen', () => {
		const plan = planBoardTransport([2000], MY);
		expect(plan.allFit).toBe(false);
	});
});

describe('planMaterialTransport', () => {
	it('plate-materiale: trengs kapping, og alt passer etter snitt', () => {
		const mat: Material = {
			id: 'm',
			name: '15mm kryss',
			kind: 'sheet',
			stockWidthMm: 2440,
			stockHeightMm: 1220,
			pricePerSquareMeterNok: 100,
			cuts: [
				{ id: 'a', widthMm: 1200, heightMm: 600, quantity: 3 },
				{ id: 'b', widthMm: 400, heightMm: 300, quantity: 6 }
			]
		};
		const res = computeMaterial(mat, 1.8);
		const plan = planMaterialTransport(res, MY);
		expect(plan.needed).toBe(true);
		expect(plan.totalCuts).toBeGreaterThan(0);
		expect(plan.allFit).toBe(true);
		expect(plan.oversized).toEqual([]);
	});

	it('lengdevare: 3,90 m lekt trenger kapping for transport', () => {
		const mat: Material = {
			id: 'm',
			name: '48x48 furu',
			kind: 'linear',
			stockLengthMm: 3900,
			pricePerMeterNok: 54,
			cuts: [{ id: 'a', lengthMm: 1200, quantity: 5 }]
		};
		const res = computeMaterial(mat, 0);
		const plan = planMaterialTransport(res, MY);
		expect(plan.needed).toBe(true);
		expect(plan.totalCuts).toBeGreaterThan(0);
		expect(plan.allFit).toBe(true);
	});

	it('ingen kapping nødvendig når platemålet allerede passer bilen', () => {
		const mat: Material = {
			id: 'm',
			name: 'liten plate',
			kind: 'sheet',
			stockWidthMm: 900,
			stockHeightMm: 600,
			pricePerSquareMeterNok: 100,
			cuts: [{ id: 'a', widthMm: 300, heightMm: 300, quantity: 2 }]
		};
		const res = computeMaterial(mat, 0);
		const plan = planMaterialTransport(res, MY);
		expect(plan.needed).toBe(false);
		expect(plan.totalCuts).toBe(0);
	});
});
