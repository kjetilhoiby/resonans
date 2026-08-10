import { describe, it, expect } from 'vitest';
import {
	detectClimbs,
	detectLaps,
	smoothElevation,
	CLIMB_DIP_TOLERANCE_M,
	MIN_CLIMB_GAIN_M,
	type Climb
} from './workout-terrain';
import { cumulativeDistanceMeters, type TrackPoint } from '$lib/utils/track-stats';

/**
 * Bygger et spor rett nordover med gitt punktavstand. 0,00001° breddegrad ≈ 1,11 m,
 * så vi regner ut deltaet av ønsket meterstep.
 */
const M_PER_DEG_LAT = 111_320;

function straightTrack(
	elevations: Array<number | null>,
	options: { stepM?: number; secPerPoint?: number; hr?: number[] } = {}
): TrackPoint[] {
	const stepM = options.stepM ?? 10;
	const secPerPoint = options.secPerPoint ?? 5;
	const t0 = Date.UTC(2026, 7, 10, 12, 0, 0);
	return elevations.map((ele, i) => ({
		lat: 59.9 + (i * stepM) / M_PER_DEG_LAT,
		lon: 10.75,
		ele,
		time: new Date(t0 + i * secPerPoint * 1000).toISOString(),
		hr: options.hr?.[i] ?? null
	}));
}

/** Rampe fra `from` til `to` over `steps` punkter. */
function ramp(from: number, to: number, steps: number): number[] {
	return Array.from({ length: steps }, (_, i) => from + ((to - from) * i) / (steps - 1));
}

function flat(value: number, steps: number): number[] {
	return new Array(steps).fill(value);
}

/**
 * Glattingen barberer endepunktene av en rampe: første punkt snitter framover og
 * siste snitter bakover, så en 30-meters stigning måles til ~29. Det er ønsket
 * oppførsel — den samme dempingen fjerner GPS-spikene — så testene sier «omtrent
 * så mye», ikke et eksakt tall. Toleransen er satt lavere enn MIN_CLIMB_GAIN_M,
 * ellers ville den skjult at en bakke forsvant.
 */
const SMOOTHING_SLACK_M = 3;

function expectGainNear(actual: number, expected: number) {
	expect(actual).toBeGreaterThanOrEqual(expected - SMOOTHING_SLACK_M);
	expect(actual).toBeLessThanOrEqual(expected);
}

describe('smoothElevation', () => {
	it('demper en enkeltstående GPS-spike uten å flytte nivået', () => {
		const eles = [...flat(100, 10), 140, ...flat(100, 10)];
		const points = straightTrack(eles);
		const cum = cumulativeDistanceMeters(points);
		const smoothed = smoothElevation(points, cum);

		const spike = smoothed[10] as number;
		expect(spike).toBeLessThan(140);
		expect(spike).toBeGreaterThan(100);
	});

	it('returnerer bare null når høyde mangler helt', () => {
		const points = straightTrack([null, null, null]);
		const cum = cumulativeDistanceMeters(points);
		expect(smoothElevation(points, cum).every((v) => v === null)).toBe(true);
	});
});

describe('detectClimbs', () => {
	it('finner en tydelig motbakke', () => {
		// 30 punkter à 10 m = 290 m, fra 100 til 130 moh → 30 m stigning, ~10 %.
		const points = straightTrack(ramp(100, 130, 30));
		const climbs = detectClimbs(points);

		expect(climbs).toHaveLength(1);
		expectGainNear(climbs[0].gainM, 30);
		expect(climbs[0].lengthM).toBeGreaterThan(250);
		expect(climbs[0].avgGradientPct).toBeGreaterThan(9);
	});

	it('ignorerer en stigning som er for kort til å bety noe', () => {
		// 8 punkter à 10 m = 70 m — under MIN_CLIMB_LENGTH_M selv med bra stigning.
		const points = straightTrack(ramp(100, 115, 8));
		expect(detectClimbs(points)).toEqual([]);
	});

	it('ignorerer en lang, slak stigning under gradientterskelen', () => {
		// 100 punkter à 10 m = 990 m, bare 15 m opp → ~1,5 %.
		const points = straightTrack(ramp(100, 115, 100));
		expect(detectClimbs(points)).toEqual([]);
	});

	it('ignorerer flatt terreng', () => {
		expect(detectClimbs(straightTrack(flat(100, 50)))).toEqual([]);
	});

	it('deler ikke en lang bakke i to på grunn av et lite platå', () => {
		// Opp, bittelitt ned (under toleransen), opp igjen — én bakke, ikke to.
		const dip = CLIMB_DIP_TOLERANCE_M - 2;
		const eles = [...ramp(100, 120, 20), ...ramp(120, 120 - dip, 5), ...ramp(120 - dip, 145, 20)];
		const climbs = detectClimbs(straightTrack(eles));

		expect(climbs).toHaveLength(1);
		expectGainNear(climbs[0].gainM, 45);
	});

	it('skiller to bakker når det er en ekte dal mellom dem', () => {
		const eles = [...ramp(100, 130, 25), ...ramp(130, 95, 25), ...ramp(95, 125, 25)];
		const climbs = detectClimbs(straightTrack(eles));

		expect(climbs).toHaveLength(2);
		expectGainNear(climbs[0].gainM, 30);
		expectGainNear(climbs[1].gainM, 30);
	});

	it('måler bakken til toppunktet, ikke til der falltoleransen løp ut', () => {
		// Stiger til 130 på punkt 24, faller så tydelig. Bakken skal slutte på toppen.
		const eles = [...ramp(100, 130, 25), ...ramp(130, 90, 25)];
		const climbs = detectClimbs(straightTrack(eles, { stepM: 10 }));

		expect(climbs).toHaveLength(1);
		// Toppen ligger på punkt 24 → 240 m inn i sporet.
		expect(climbs[0].endDistanceM).toBeLessThanOrEqual(250);
		expectGainNear(climbs[0].gainM, 30);
	});

	it('regner tid, tempo og puls for bakken', () => {
		const hr = new Array(30).fill(0).map((_, i) => 150 + i);
		const points = straightTrack(ramp(100, 130, 30), { secPerPoint: 4, hr });
		const climbs = detectClimbs(points);

		expect(climbs).toHaveLength(1);
		const climb = climbs[0] as Climb;
		expect(climb.durationSec).toBe(29 * 4);
		expect(climb.avgHr).toBe(165); // snitt av 150..179 = 164,5, rundet opp
		expect(climb.maxHr).toBe(179);
		expect(climb.avgPaceSecPerKm).toBeGreaterThan(0);
	});

	it('gir null for tid og tempo når sporet mangler tidsstempler', () => {
		const points = straightTrack(ramp(100, 130, 30)).map((p) => ({ ...p, time: null }));
		const climbs = detectClimbs(points);

		expect(climbs).toHaveLength(1);
		expect(climbs[0].durationSec).toBeNull();
		expect(climbs[0].avgPaceSecPerKm).toBeNull();
	});

	it('krever mer enn støygulvet i høydemeter', () => {
		const points = straightTrack(ramp(100, 100 + MIN_CLIMB_GAIN_M - 3, 30));
		expect(detectClimbs(points)).toEqual([]);
	});

	it('tåler et spor helt uten høydedata', () => {
		expect(detectClimbs(straightTrack([null, null, null, null]))).toEqual([]);
	});
});

/** Kvadratisk løkke med gitt sidelengde, gjentatt `laps` ganger. */
function loopTrack(laps: number, sideM = 200, stepM = 20, secPerPoint = 6): TrackPoint[] {
	const perSide = Math.round(sideM / stepM);
	const dLat = stepM / M_PER_DEG_LAT;
	const dLon = stepM / (M_PER_DEG_LAT * Math.cos((59.9 * Math.PI) / 180));
	const t0 = Date.UTC(2026, 7, 10, 12, 0, 0);

	const points: TrackPoint[] = [];
	let lat = 59.9;
	let lon = 10.75;
	let n = 0;
	const push = () => {
		points.push({ lat, lon, ele: 100, time: new Date(t0 + n * secPerPoint * 1000).toISOString(), hr: 150 });
		n += 1;
	};
	push();
	for (let l = 0; l < laps; l++) {
		for (let i = 0; i < perSide; i++) { lat += dLat; push(); }
		for (let i = 0; i < perSide; i++) { lon += dLon; push(); }
		for (let i = 0; i < perSide; i++) { lat -= dLat; push(); }
		for (let i = 0; i < perSide; i++) { lon -= dLon; push(); }
	}
	return points;
}

describe('detectLaps', () => {
	it('finner tre runder på en løkke', () => {
		const laps = detectLaps(loopTrack(3));
		expect(laps).toHaveLength(3);
		expect(laps.map((l) => l.index)).toEqual([1, 2, 3]);
	});

	it('gir rundelengde nær løkkas omkrets', () => {
		const laps = detectLaps(loopTrack(3, 200));
		for (const lap of laps) {
			expect(lap.distanceM).toBeGreaterThan(700);
			expect(lap.distanceM).toBeLessThan(900);
		}
	});

	it('regner tid, tempo og puls per runde', () => {
		const laps = detectLaps(loopTrack(2));
		expect(laps[0].durationSec).toBeGreaterThan(0);
		expect(laps[0].avgPaceSecPerKm).toBeGreaterThan(0);
		expect(laps[0].avgHr).toBe(150);
	});

	it('rapporterer ingen runder for én enkelt løkke — det er bare en tur hjem igjen', () => {
		expect(detectLaps(loopTrack(1))).toEqual([]);
	});

	it('rapporterer ingen runder for et rett spor', () => {
		const points = straightTrack(flat(100, 100), { stepM: 20 });
		expect(detectLaps(points)).toEqual([]);
	});

	it('teller ikke et frem-og-tilbake som runder', () => {
		// Ut 500 m og rett tilbake samme vei: passerer aldri et anker det har
		// forlatt uten å snu, så det gir maks én lukking — under kravet på to.
		const out = straightTrack(flat(100, 25), { stepM: 20 });
		const back = [...out].reverse().map((p, i) => ({
			...p,
			time: new Date(Date.UTC(2026, 7, 10, 12, 0, 0) + (25 + i) * 5000).toISOString()
		}));
		expect(detectLaps([...out, ...back])).toEqual([]);
	});

	it('tåler et for kort spor', () => {
		expect(detectLaps([{ lat: 59.9, lon: 10.75 }])).toEqual([]);
	});
});
