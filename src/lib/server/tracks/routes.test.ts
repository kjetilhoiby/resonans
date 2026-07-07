import { describe, it, expect } from 'vitest';
import {
	defaultRouteSeeds,
	defaultVariantsForKind,
	routeEffortRange,
	variantEffort,
	type RouteInput
} from './routes';

describe('variantEffort — løp med fartsvarianter', () => {
	const pendler: RouteInput = {
		kind: 'run',
		distanceMeters: 8000,
		variants: [
			{ label: 'Rolig', paceSecPerKm: 400 },
			{ label: 'Terskel', paceSecPerKm: 330 }
		]
	};

	it('samme rute: terskel koster mer enn rolig (intensitets-justert)', () => {
		const rolig = variantEffort(pendler, pendler.variants[0], 400);
		const terskel = variantEffort(pendler, pendler.variants[1], 400);
		// Rolig i egen easy-pace: 8 km × 6:40 = 53.3 min × 2.5 = 133, faktor 1.0
		expect(rolig.effort).toBe(133);
		// Terskel: kortere tid MEN høyere intensitet — netto høyere effort
		expect(terskel.effort).toBeGreaterThan(rolig.effort);
		expect(terskel.detail).toBe('8 km @ 5:30');
	});

	it('uten easy-pace-referanse: flat MET (faktor 1)', () => {
		const rolig = variantEffort(pendler, pendler.variants[0], null);
		expect(rolig.effort).toBe(133);
	});
});

describe('variantEffort — høydemeter og sti', () => {
	it('høydemeter øker effort (100 hm ≈ 1 km flatt)', () => {
		const flat: RouteInput = { kind: 'run', distanceMeters: 6000, variants: [{ label: 'Jevnt', paceSecPerKm: 400 }] };
		const kupert: RouteInput = { kind: 'run', distanceMeters: 6000, elevationMeters: 200, variants: flat.variants };
		const flatE = variantEffort(flat, flat.variants[0], 400);
		const kupertE = variantEffort(kupert, kupert.variants[0], 400);
		// 200 hm ≈ +2 km flatt → 8 km-ekvivalent mot 6 km
		expect(kupertE.effort).toBeGreaterThan(flatE.effort);
		expect(kupertE.detail).toContain('200 hm');
	});

	it('sti: sakte løp underskåres ikke (intensiteten gulves på 1.0)', () => {
		// Samme sakte pace (litt saktere enn easy) på vei vs sti.
		const easy = 400;
		const slow = 440; // saktere enn easy → vei ville gitt intensitet < 1
		const vei: RouteInput = { kind: 'run', distanceMeters: 6000, variants: [{ label: 'Rolig', paceSecPerKm: slow }] };
		const sti: RouteInput = { kind: 'trail', distanceMeters: 6000, variants: [{ label: 'Rolig', paceSecPerKm: slow }] };
		const veiE = variantEffort(vei, vei.variants[0], easy);
		const stiE = variantEffort(sti, sti.variants[0], easy);
		// Vei: (400/440)² ≈ 0.83 < 1 → nedskalert. Sti: gulvet på 1.0.
		expect(stiE.effort).toBeGreaterThan(veiE.effort);
	});

	it('sti uten easy-pace-referanse bruker minst 1.0 i intensitet', () => {
		const sti: RouteInput = { kind: 'trail', distanceMeters: 6000, variants: [{ label: 'Jevnt', paceSecPerKm: 400 }] };
		const v = variantEffort(sti, sti.variants[0], null);
		// 6 km × 6:40 = 40 min × 2.5 × 1.0 = 100
		expect(v.effort).toBe(100);
	});
});

describe('variantEffort — bakkeintervaller', () => {
	const bakke: RouteInput = {
		kind: 'hill',
		variants: [{ label: '10 × 200 m', reps: 10, repDistanceMeters: 200, paceSecPerKm: 300 }]
	};

	it('reps × (drag + hvile), intensitets-justert, med detalj-label', () => {
		const v = variantEffort(bakke, bakke.variants[0], 400);
		expect(v.detail).toBe('10×200 m');
		expect(v.effort).toBeGreaterThan(0);
		// 10 × (0.2km×300 + 0.2km×480) = 10 × (60+96) = 1560 s = 26 min
		expect(v.durationMin).toBe(26);
	});

	it('flere reps → mer effort', () => {
		const seks = variantEffort(bakke, { label: '6', reps: 6, repDistanceMeters: 200, paceSecPerKm: 300 }, 400);
		const ti = variantEffort(bakke, bakke.variants[0], 400);
		expect(ti.effort).toBeGreaterThan(seks.effort);
	});
});

describe('variantEffort — sykkel vs el-sykkel samme rute', () => {
	const rute: RouteInput = {
		kind: 'bike',
		distanceMeters: 8000,
		variants: [
			{ label: 'Sykkel', family: 'cycling' },
			{ label: 'El-sykkel', family: 'ebike' }
		]
	};

	it('el-sykkel gir lavere effort enn manuell på samme distanse', () => {
		const sykkel = variantEffort(rute, rute.variants[0], null);
		const el = variantEffort(rute, rute.variants[1], null);
		expect(el.effort).toBeLessThan(sykkel.effort);
	});
});

describe('routeEffortRange', () => {
	it('gir min/maks over variantene', () => {
		const rute: RouteInput = {
			kind: 'run',
			distanceMeters: 8000,
			variants: [
				{ label: 'Rolig', paceSecPerKm: 400 },
				{ label: 'Moderat', paceSecPerKm: 360 },
				{ label: 'Terskel', paceSecPerKm: 330 }
			]
		};
		const range = routeEffortRange(rute, 400);
		expect(range.variants).toHaveLength(3);
		expect(range.minEffort).toBe(range.variants[0].effort);
		expect(range.maxEffort).toBe(range.variants[2].effort);
		expect(range.maxEffort).toBeGreaterThan(range.minEffort);
	});
});

describe('defaultVariantsForKind', () => {
	it('løp: rolig/moderat/terskel skalert til pace', () => {
		const v = defaultVariantsForKind('run', 400);
		expect(v.map((x) => x.label)).toEqual(['Rolig', 'Moderat', 'Terskel']);
		expect(v[0].paceSecPerKm).toBe(400);
		expect(v[2].paceSecPerKm!).toBeLessThan(v[0].paceSecPerKm!);
	});

	it('sti: rolig + jevnt', () => {
		const v = defaultVariantsForKind('trail', 400);
		expect(v.map((x) => x.label)).toEqual(['Rolig', 'Jevnt']);
	});

	it('sykkel: sykkel + el-sykkel som familier', () => {
		const v = defaultVariantsForKind('bike', null);
		expect(v.map((x) => x.family)).toEqual(['cycling', 'ebike']);
	});

	it('bakke: ett intervall-drag som utgangspunkt', () => {
		const v = defaultVariantsForKind('hill', 400);
		expect(v[0].reps).toBe(10);
		expect(v[0].repDistanceMeters).toBe(200);
	});
});

describe('defaultRouteSeeds', () => {
	it('gir de forventede startrutene, skalert til brukerens pace', () => {
		const seeds = defaultRouteSeeds(390);
		const navn = seeds.map((s) => s.name);
		expect(navn).toContain('Pendlerunde');
		expect(navn).toContain('Pendlerunde (sykkel)');
		expect(navn).toContain('Vannrunden');
		expect(navn).toContain('Motbakke 200 m');
		// Pendlerunde-terskel er raskere enn rolig
		const pendler = seeds.find((s) => s.name === 'Pendlerunde')!;
		const rolig = pendler.variants.find((v) => v.label === 'Rolig')!;
		const terskel = pendler.variants.find((v) => v.label === 'Terskel')!;
		expect(terskel.paceSecPerKm!).toBeLessThan(rolig.paceSecPerKm!);
	});

	it('faller tilbake til 6:40 uten pace-referanse', () => {
		const seeds = defaultRouteSeeds(null);
		const pendler = seeds.find((s) => s.name === 'Pendlerunde')!;
		expect(pendler.variants.find((v) => v.label === 'Rolig')!.paceSecPerKm).toBe(400);
	});
});
