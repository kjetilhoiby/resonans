import { describe, it, expect } from 'vitest';
import {
	defaultRouteSeeds,
	defaultVariantsForKind,
	inferPaceFactors,
	parsePaceText,
	parseRouteForm,
	routeEffortRange,
	variantEffort,
	type RouteInput,
	type RouteVariant
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

describe('paceFactor — re-forankring mot dagens easy-pace', () => {
	it('faktor-variant oppløses mot dagens easy, ikke lagret snapshot-pace', () => {
		const rute: RouteInput = {
			kind: 'run',
			distanceMeters: 8000,
			variants: [{ label: 'Rolig', paceFactor: 1.0, paceSecPerKm: 400 }]
		};
		// Dagens easy = 480 → 8 km × 8:00 = 64 min × 2.5 × 1.0 = 160 (ikke 133 fra 400)
		const v = variantEffort(rute, rute.variants[0], 480);
		expect(v.effort).toBe(160);
		expect(v.detail).toBe('8 km @ 8:00');
	});

	it('stale seedet variantsett: terskel koster mer enn rolig etter re-forankring', () => {
		// Seedet med fallback-anker 400, brukerens faktiske easy er 476 — dette
		// ga invertert rekkefølge (rolig dyrest) fordi alle traff intensitets-taket.
		const stale: RouteVariant[] = [
			{ label: 'Rolig', paceSecPerKm: 400 },
			{ label: 'Moderat', paceSecPerKm: 360 },
			{ label: 'Terskel', paceSecPerKm: 328 }
		];
		const rute: RouteInput = {
			kind: 'run',
			distanceMeters: 7600,
			elevationMeters: 56,
			variants: inferPaceFactors('run', stale)
		};
		const range = routeEffortRange(rute, 476);
		const [rolig, moderat, terskel] = range.variants;
		expect(rolig.effort).toBeLessThan(moderat.effort);
		expect(moderat.effort).toBeLessThan(terskel.effort);
	});
});

describe('inferPaceFactors', () => {
	it('stempler faktorer på sett som matcher default-mønsteret (± avrunding)', () => {
		const seeded: RouteVariant[] = [
			{ label: 'Rolig', paceSecPerKm: 400 },
			{ label: 'Moderat', paceSecPerKm: 360 },
			{ label: 'Terskel', paceSecPerKm: 328 }
		];
		const result = inferPaceFactors('run', seeded);
		expect(result.map((v) => v.paceFactor)).toEqual([1.0, 0.9, 0.82]);
	});

	it('rører ikke manuelt justerte farter (mønsteret matcher ikke)', () => {
		const manuell: RouteVariant[] = [
			{ label: 'Rolig', paceSecPerKm: 400 },
			{ label: 'Moderat', paceSecPerKm: 345 }, // bruker-satt, ikke 0.9×400
			{ label: 'Terskel', paceSecPerKm: 328 }
		];
		expect(inferPaceFactors('run', manuell).every((v) => v.paceFactor == null)).toBe(true);
	});

	it('rører ikke sett som allerede har faktorer', () => {
		const medFaktor: RouteVariant[] = [
			{ label: 'Rolig', paceFactor: 1.0, paceSecPerKm: 999 },
			{ label: 'Terskel', paceSecPerKm: 328 }
		];
		expect(inferPaceFactors('run', medFaktor)).toBe(medFaktor);
	});

	it('sti-sett gjenkjennes med sti-faktorene', () => {
		const seeded: RouteVariant[] = [
			{ label: 'Rolig', paceSecPerKm: 420 },
			{ label: 'Jevnt', paceSecPerKm: 400 }
		];
		expect(inferPaceFactors('trail', seeded).map((v) => v.paceFactor)).toEqual([1.05, 1.0]);
	});

	it('ett enkelt pace-punkt kan ikke skilles fra manuelt — beholdes absolutt', () => {
		const single: RouteVariant[] = [{ label: 'Rolig', paceSecPerKm: 400 }];
		expect(inferPaceFactors('run', single)[0].paceFactor).toBeUndefined();
	});

	it('sykkel/bakke-varianter passerer urørt', () => {
		const bike: RouteVariant[] = [{ label: 'Sykkel', family: 'cycling' }];
		expect(inferPaceFactors('bike', bike)).toBe(bike);
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

describe('parsePaceText', () => {
	it('tolker mm:ss som sekunder per km', () => {
		expect(parsePaceText('5:30')).toBe(330);
		expect(parsePaceText('04:00')).toBe(240);
	});

	it('avviser alt som ikke er mm:ss', () => {
		expect(parsePaceText('5.30')).toBeUndefined();
		expect(parsePaceText('530')).toBeUndefined();
		expect(parsePaceText('')).toBeUndefined();
		expect(parsePaceText(undefined)).toBeUndefined();
		expect(parsePaceText('0:00')).toBeUndefined();
	});
});

describe('parseRouteForm', () => {
	function form(fields: Record<string, string>) {
		return (key: string) => fields[key];
	}

	it('krever navn', () => {
		const result = parseRouteForm(form({ kind: 'run' }));
		expect(result).toEqual({ ok: false, error: 'Mangler navn' });
	});

	it('bygger fartsvarianter for løperuter', () => {
		const result = parseRouteForm(
			form({ name: 'Sognsvann', kind: 'run', pace_Rolig: '5:30', pace_Terskel: '4:10' })
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.variants).toEqual([
			{ label: 'Rolig', paceSecPerKm: 330 },
			{ label: 'Terskel', paceSecPerKm: 250 }
		]);
	});

	it('gir én «Jevnt»-variant når ingen fart er oppgitt', () => {
		const result = parseRouteForm(form({ name: 'Rundt vannet', kind: 'run' }));
		expect(result.ok && result.value.variants).toEqual([{ label: 'Jevnt' }]);
	});

	it('gir sykkelruter to faste varianter', () => {
		const result = parseRouteForm(form({ name: 'Maridalen', kind: 'bike' }));
		expect(result.ok && result.value.variants).toEqual([
			{ label: 'Sykkel', family: 'cycling' },
			{ label: 'El-sykkel', family: 'ebike' }
		]);
	});

	it('bygger dragserie for bakkeruter, med standardverdier', () => {
		const withDefaults = parseRouteForm(form({ name: 'Bakken', kind: 'hill' }));
		expect(withDefaults.ok && withDefaults.value.variants[0].label).toBe('10 × 200 m');

		const explicit = parseRouteForm(
			form({ name: 'Bakken', kind: 'hill', reps: '6', repDistanceMeters: '400' })
		);
		expect(explicit.ok && explicit.value.variants[0]).toEqual({
			label: '6 × 400 m',
			reps: 6,
			repDistanceMeters: 400,
			paceSecPerKm: 300
		});
	});

	it('regner km om til meter og lar tomme felt bli null', () => {
		const result = parseRouteForm(form({ name: 'Tur', kind: 'run', distanceKm: '5.5' }));
		expect(result.ok && result.value.distanceMeters).toBe(5500);
		expect(result.ok && result.value.elevationMeters).toBeNull();
		expect(result.ok && result.value.terrain).toBeNull();
	});

	it('faller tilbake til «run» for ukjent rutetype', () => {
		const result = parseRouteForm(form({ name: 'Tur', kind: 'rakett' }));
		expect(result.ok && result.value.kind).toBe('run');
	});
});
