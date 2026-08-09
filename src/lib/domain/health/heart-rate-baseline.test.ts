import { describe, it, expect } from 'vitest';
import {
	buildHeartRateBaseline,
	DEFAULT_MAX_HR,
	DEFAULT_REST_HR,
	MIN_HR_SPREAD,
	MIN_SAMPLES,
	resolveMaxHr,
	resolveRestingHr,
	type RestingHrCandidate
} from './heart-rate-baseline';

function candidates(source: RestingHrCandidate['source'], values: number[]): RestingHrCandidate[] {
	return values.map((value) => ({ value, source }));
}

describe('resolveRestingHr', () => {
	it('foretrekker sovepuls over alt annet', () => {
		const result = resolveRestingHr([
			...candidates('sleep_min', [50, 51, 52]),
			...candidates('scale_spot', [58, 59, 60]),
			...candidates('daily_min', [55, 56, 57])
		]);
		expect(result.source).toBe('sleep_min');
		expect(result.restHr).toBe(51);
	});

	it('faller til punktpuls når søvn mangler', () => {
		// Vekta måler stående, så tallet ligger høyere — men den er daglig og
		// finnes selv når man ikke hadde klokka på.
		const result = resolveRestingHr([
			...candidates('scale_spot', [57, 58, 59]),
			...candidates('daily_min', [55, 56, 57])
		]);
		expect(result.source).toBe('scale_spot');
		expect(result.restHr).toBe(58);
	});

	it('faller videre til dagsminimum, så til sovesnitt', () => {
		expect(resolveRestingHr(candidates('daily_min', [54, 55, 56])).source).toBe('daily_min');
		expect(resolveRestingHr(candidates('sleep_avg', [60, 61, 62])).source).toBe('sleep_avg');
	});

	it('krever nok observasjoner før en kilde brukes', () => {
		const result = resolveRestingHr([
			...candidates('sleep_min', [50, 51]), // for få
			...candidates('scale_spot', [58, 59, 60])
		]);
		expect(result.source).toBe('scale_spot');
		expect(MIN_SAMPLES).toBe(3);
	});

	it('tar medianen INNENFOR kilden, aldri på tvers', () => {
		// Å blande en sovepuls med et minimum fra en treningsøkt gir et tall som
		// ikke er noen av dem. Det var den gamle feilen: alle hr_min i én bøtte.
		const result = resolveRestingHr([
			...candidates('sleep_min', [48, 50, 52, 54, 56]),
			// Disse ville dratt en felles median opp. De skal ikke telle med.
			...candidates('scale_spot', [70, 72, 74]),
			...candidates('daily_min', [66, 68, 70])
		]);
		expect(result.source).toBe('sleep_min');
		expect(result.restHr).toBe(52);
		expect(result.samples).toBe(5);
	});

	it('avviser verdier utenfor kildens plausible område', () => {
		// En sovende puls på 95 er ikke hvile.
		const result = resolveRestingHr(candidates('sleep_min', [95, 96, 97]));
		expect(result.source).toBe('default');
		expect(result.restHr).toBe(DEFAULT_REST_HR);
	});

	it('godtar en høyere verdi fra vekta enn fra søvn', () => {
		// Stående måling har et videre plausibelt område.
		expect(resolveRestingHr(candidates('scale_spot', [100, 101, 102])).source).toBe('scale_spot');
		expect(resolveRestingHr(candidates('sleep_min', [100, 101, 102])).source).toBe('default');
	});

	it('faller til default for tom liste', () => {
		const result = resolveRestingHr([]);
		expect(result).toEqual({ restHr: DEFAULT_REST_HR, source: 'default', samples: 0 });
	});
});

describe('resolveMaxHr', () => {
	it('lar brukerens egen verdi vinne over alt', () => {
		const result = resolveMaxHr({ manual: 186, observedMaxes: [201, 199, 198, 197, 196] });
		expect(result.source).toBe('manual');
		expect(result.maxHr).toBe(186);
	});

	it('avviser en oppgitt verdi som ikke er troverdig', () => {
		expect(resolveMaxHr({ manual: 300, observedMaxes: [188] }).source).toBe('observed');
		expect(resolveMaxHr({ manual: 80, observedMaxes: [188] }).source).toBe('observed');
		expect(resolveMaxHr({ manual: null, observedMaxes: [188] }).source).toBe('observed');
	});

	it('bruker alderen framfor observerte topper når brukeren ikke har satt noe', () => {
		// Kjernen i august 2026-rettelsen: observerte topper er bare en makspuls
		// hvis man har vært på maks. En bruker som ikke racer får en for lav
		// «maks», og en for lav maks blåser opp HRR — og dermed effort.
		const result = resolveMaxHr({ age: 45, observedMaxes: [172, 170, 169, 168, 167, 166] });
		expect(result.source).toBe('age');
		expect(result.maxHr).toBe(177); // Tanaka: 208 − 0,7 × 45
	});

	it('lar brukerens egen verdi vinne over alderen', () => {
		expect(resolveMaxHr({ manual: 186, age: 45, observedMaxes: [] }).source).toBe('manual');
		expect(resolveMaxHr({ manual: 186, age: 45, observedMaxes: [] }).maxHr).toBe(186);
	});

	it('lar en observert topp OVER aldersanslaget vinne — den er en måling', () => {
		// Formelen er et populasjonssnitt med reell spredning. Har man faktisk
		// registrert 192 mens formelen sier 177, er formelen for lav — og en for
		// lav makspuls er nettopp feilen vi retter.
		const result = resolveMaxHr({ age: 45, observedMaxes: [195, 192, 191, 190, 189, 188] });
		expect(result.source).toBe('observed');
		expect(result.maxHr).toBe(192); // persentil-trimmet, så spiken på 195 faller
	});

	it('faller tilbake til observerte topper når alderen mangler', () => {
		const result = resolveMaxHr({ age: null, observedMaxes: [215, 188, 186, 185, 184, 183] });
		expect(result.source).toBe('observed');
		expect(result.maxHr).toBe(188);
	});

	it('ignorerer en alder som gir en utroverdig makspuls', () => {
		// 108 år → 132, under MAX_HR_MIN. Da er observasjonene bedre enn formelen.
		const result = resolveMaxHr({ age: 108, observedMaxes: [175] });
		expect(result.source).toBe('observed');
	});

	it('forkaster den høyeste observasjonen som artefakt når det er nok av dem', () => {
		// Math.max var den gamle regelen, og én pulsspike satte makspulsen for 30
		// dager — som gir for lav VDOT og for lave soner.
		const result = resolveMaxHr({ observedMaxes: [215, 188, 186, 185, 184, 183] });
		expect(result.maxHr).toBe(188);
		expect(result.source).toBe('observed');
	});

	it('bruker maks når det er for få observasjoner til en persentil', () => {
		expect(resolveMaxHr({ observedMaxes: [188, 185] }).maxHr).toBe(188);
		expect(resolveMaxHr({ observedMaxes: [188] }).maxHr).toBe(188);
	});

	it('filtrerer bort urimelige observasjoner', () => {
		const result = resolveMaxHr({ observedMaxes: [250, 45, 188, 186, 185, 184] });
		// 250 og 45 forkastes; av de fire gjenværende brukes maks (under fem).
		expect(result.maxHr).toBe(188);
	});

	it('bruker snittpuls som svak siste utvei', () => {
		const result = resolveMaxHr({ observedMaxes: [], workoutAverages: [150, 148] });
		expect(result.source).toBe('avg_proxy');
		expect(result.maxHr).toBe(158);
	});

	it('faller til default når ingenting finnes', () => {
		const result = resolveMaxHr({ observedMaxes: [] });
		expect(result).toEqual({ maxHr: DEFAULT_MAX_HR, source: 'default', samples: 0 });
	});
});

describe('buildHeartRateBaseline', () => {
	it('regner HRR og bærer kildene videre', () => {
		const baseline = buildHeartRateBaseline(
			{ restHr: 51, source: 'sleep_min', samples: 20 },
			{ maxHr: 188, source: 'observed', samples: 12 }
		);
		expect(baseline.hrr).toBe(137);
		expect(baseline.restHrSource).toBe('sleep_min');
		expect(baseline.maxHrSource).toBe('observed');
		expect(baseline.derived).toBe(true);
	});

	it('garanterer minste spredning så TRIMP-brøken ikke eksploderer', () => {
		const baseline = buildHeartRateBaseline(
			{ restHr: 70, source: 'scale_spot', samples: 5 },
			{ maxHr: 100, source: 'observed', samples: 3 }
		);
		expect(baseline.maxHr).toBe(70 + MIN_HR_SPREAD);
		expect(baseline.hrr).toBe(MIN_HR_SPREAD);
	});

	it('er ikke «derived» når én av sidene er default', () => {
		expect(
			buildHeartRateBaseline(
				{ restHr: DEFAULT_REST_HR, source: 'default', samples: 0 },
				{ maxHr: 188, source: 'observed', samples: 9 }
			).derived
		).toBe(false);
		expect(
			buildHeartRateBaseline(
				{ restHr: 51, source: 'sleep_min', samples: 9 },
				{ maxHr: DEFAULT_MAX_HR, source: 'default', samples: 0 }
			).derived
		).toBe(false);
	});

	it('en manuell makspuls teller som derived', () => {
		expect(
			buildHeartRateBaseline(
				{ restHr: 51, source: 'sleep_min', samples: 9 },
				{ maxHr: 186, source: 'manual', samples: 0 }
			).derived
		).toBe(true);
	});
});
