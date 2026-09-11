import { describe, it, expect } from 'vitest';
import {
	buildNormalBand,
	distanceOutside,
	MIN_NORM_SAMPLES,
	normalDirection,
	placeInNormal,
	rankInNormal,
	recentValue
} from './normal-band';

/** N verdier jevnt fordelt over [from, to]. */
function spread(from: number, to: number, n: number): number[] {
	return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}

describe('buildNormalBand', () => {
	it('legger båndet på p10–p90', () => {
		const band = buildNormalBand(spread(0, 100, 101));

		expect(band).not.toBeNull();
		expect(band!.low).toBeCloseTo(10, 5);
		expect(band!.high).toBeCloseTo(90, 5);
		expect(band!.median).toBeCloseTo(50, 5);
	});

	it('tier under gulvet for antall målinger', () => {
		// Et normalområde av tolv målinger er en gjetning med desimaler.
		expect(buildNormalBand(spread(40, 60, MIN_NORM_SAMPLES - 1))).toBeNull();
		expect(buildNormalBand(spread(40, 60, MIN_NORM_SAMPLES))).not.toBeNull();
	});

	it('lar seg ikke rive av én avvikende natt', () => {
		// Poenget med persentiler framfor snitt ± standardavvik.
		const rene = spread(50, 70, 60);
		const medUtligger = [...rene, 400];

		const a = buildNormalBand(rene)!;
		const b = buildNormalBand(medUtligger)!;

		expect(b.high - a.high).toBeLessThan(2);
	});
});

describe('rankInNormal', () => {
	it('sier hvor stor andel av de friske dagene som ligger under', () => {
		// 101 verdier 0–100: fem av dem (0–4) ligger under 5.
		const band = buildNormalBand(spread(0, 100, 101))!;

		expect(rankInNormal(band, 5)).toBeCloseTo(5 / 101, 5);
		expect(rankInNormal(band, 96)).toBeCloseTo(96 / 101, 5);
	});

	it('teller strengt under, så en verdi lik den laveste får rang 0', () => {
		// Ellers ville «lavere enn 0 %» blitt «lavere enn 1 %» på et tall som
		// faktisk er det laveste vi har målt.
		const band = buildNormalBand(spread(40, 60, 60))!;

		expect(rankInNormal(band, 40)).toBe(0);
	});
});

describe('distanceOutside', () => {
	const band = buildNormalBand(spread(40, 60, 101))!;

	it('er null innenfor båndet', () => {
		expect(distanceOutside(band, 50)).toBe(0);
	});

	it('måler avstanden ut, uansett side', () => {
		expect(distanceOutside(band, band.low - 4)).toBeCloseTo(4, 5);
		expect(distanceOutside(band, band.high + 3)).toBeCloseTo(3, 5);
	});
});

describe('normalDirection', () => {
	const band = buildNormalBand(spread(52, 68, 101))!;

	it('leser en HRV som stiger nedenfra som på vei MOT', () => {
		expect(normalDirection(band, 44, 51)).toBe('mot');
	});

	it('leser en sovepuls som faller ovenfra som på vei MOT', () => {
		// Retningen i VERDI er motsatt av tilfellet over; retningen mot
		// normalen er den samme, og det er den vi navngir.
		const puls = buildNormalBand(spread(40, 48, 101))!;
		expect(normalDirection(puls, 55, 49)).toBe('mot');
	});

	it('kaller en liten endring stabil framfor en retning', () => {
		// Terskelen er en andel av båndets egen bredde, så den er den samme i
		// ms, slag og timer uten tre konstanter.
		expect(normalDirection(band, 44, 44.5)).toBe('stabil');
	});

	it('sier fra når det går bort fra', () => {
		expect(normalDirection(band, 48, 40)).toBe('fra');
	});
});

describe('recentValue', () => {
	it('tar medianen av halen, ikke siste måling', () => {
		// Én dårlig natt til slutt skal ikke avgjøre om du er «tilbake».
		expect(recentValue([60, 61, 62, 63, 40])).toBe(62);
	});

	it('gir null uten målinger', () => {
		expect(recentValue([])).toBeNull();
	});
});

describe('placeInNormal', () => {
	const band = buildNormalBand(spread(52, 68, 101))!;

	it('plasserer forløpet utenfor og sier at det ikke er tilbake', () => {
		const standing = placeInNormal(band, 44, [46, 44, 43, 44, 45]);

		expect(standing.duringInside).toBe(false);
		expect(standing.duringRank).toBe(0);
		expect(standing.recentInside).toBe(false);
	});

	it('ser at de ferskeste målingene er tilbake i båndet', () => {
		const standing = placeInNormal(band, 44, [44, 43, 58, 60, 59]);

		expect(standing.duringInside).toBe(false);
		expect(standing.recentInside).toBe(true);
		expect(standing.direction).toBe('mot');
	});

	it('har ingen retning uten målinger', () => {
		const standing = placeInNormal(band, 44, []);

		expect(standing.recentInside).toBeNull();
		expect(standing.direction).toBeNull();
	});
});
