import { describe, it, expect } from 'vitest';
import {
	computeMovingTime,
	stoppedShare,
	MIN_POINTS,
	MOVING_THRESHOLD_MS_BY_FAMILY,
	type MovingTimePoint
} from './moving-time';

const START = Date.parse('2026-08-10T09:00:00Z');

/** ~111 320 meter per breddegrad. Nok presisjon for en test. */
const METERS_PER_DEGREE_LAT = 111320;

/**
 * Bygger et spor: hvert segment sier hvor mange sekunder det varer, med hvilken
 * fart (m/s), og med hvor mange sekunder mellom hvert punkt.
 */
function track(
	segments: Array<{ seconds: number; speedMs: number; sampleSeconds?: number; jitterMeters?: number }>
): MovingTimePoint[] {
	const points: MovingTimePoint[] = [];
	let tSec = 0;
	let northMeters = 0;
	let jitterSeed = 1;
	points.push({ lat: 59.9, lon: 10.75, time: new Date(START).toISOString() });
	for (const segment of segments) {
		const step = segment.sampleSeconds ?? 4;
		for (let elapsed = step; elapsed <= segment.seconds; elapsed += step) {
			tSec += step;
			northMeters += segment.speedMs * step;
			// Deterministisk «støy» som veksler fram og tilbake, slik ekte
			// GPS-jitter gjør når man står stille.
			jitterSeed = (jitterSeed * 1103515245 + 12345) % 2147483648;
			const jitter = segment.jitterMeters
				? ((jitterSeed % 200) / 100 - 1) * segment.jitterMeters
				: 0;
			points.push({
				lat: 59.9 + (northMeters + jitter) / METERS_PER_DEGREE_LAT,
				lon: 10.75,
				time: new Date(START + tSec * 1000).toISOString()
			});
		}
	}
	return points;
}

describe('computeMovingTime', () => {
	it('kutter den døde halen når sporingen ble glemt', () => {
		// Den faktiske saken: ~25 min el-sykkel, så nesten to timer i ro.
		const points = track([
			{ seconds: 1500, speedMs: 6 },
			{ seconds: 6900, speedMs: 0, jitterMeters: 4 }
		]);

		const result = computeMovingTime(points, { sportType: 'e_bike' });

		expect(result).not.toBeNull();
		expect(result!.elapsedSeconds).toBe(8400);
		expect(result!.movingSeconds).toBeGreaterThan(1400);
		expect(result!.movingSeconds).toBeLessThan(1600);
		expect(stoppedShare(result!)).toBeGreaterThan(0.8);
	});

	it('lar en økt uten stillstand stå urørt', () => {
		const points = track([{ seconds: 1800, speedMs: 3 }]);

		const result = computeMovingTime(points, { sportType: 'running' });

		expect(result).not.toBeNull();
		expect(result!.movingSeconds).toBeGreaterThan(1750);
		expect(result!.movingSeconds).toBeLessThanOrEqual(result!.elapsedSeconds);
		expect(stoppedShare(result!)).toBeLessThan(0.05);
	});

	it('damper GPS-støy under stillstand til en rest', () => {
		// Fella terskelen finnes for: står man stille spriker punktene 2–5 meter,
		// og mellom to nabopunkter fire sekunder fra hverandre ser det ut som
		// over én meter i sekundet.
		//
		// Vinduet fjerner ikke støyen helt — treffer to motsatt rettede utslag
		// hverandre i endepunktene, slipper et intervall gjennom. Kravet er
		// derfor at resten er liten, ikke at den er null. Retningen på feilen er
		// den trygge: vi krediterer litt for mye tid, aldri for lite.
		const points = track([{ seconds: 1200, speedMs: 0, jitterMeters: 5 }]);

		const result = computeMovingTime(points, { sportType: 'running' });

		expect(result).not.toBeNull();
		expect(result!.movingSeconds).toBeLessThan(result!.elapsedSeconds * 0.1);
	});

	it('krediterer et rødlys som stillstand, men beholder resten av turen', () => {
		const points = track([
			{ seconds: 600, speedMs: 6 },
			{ seconds: 120, speedMs: 0, jitterMeters: 2 },
			{ seconds: 600, speedMs: 6 }
		]);

		const result = computeMovingTime(points, { sportType: 'cycling' });

		expect(result).not.toBeNull();
		expect(result!.elapsedSeconds).toBe(1320);
		// Vinduet på ti sekunder gjør at overgangene rundt stoppet blir litt
		// uskarpe — poenget er at de to minuttene i hovedsak forsvinner.
		expect(result!.movingSeconds).toBeGreaterThan(1150);
		expect(result!.movingSeconds).toBeLessThan(1250);
	});

	it('returnerer null for styrke og yoga, der begrepet ikke gir mening', () => {
		const points = track([{ seconds: 1800, speedMs: 0, jitterMeters: 3 }]);

		expect(computeMovingTime(points, { sportType: 'strength_training' })).toBeNull();
		expect(computeMovingTime(points, { sportType: 'yoga' })).toBeNull();
	});

	it('returnerer null framfor et tall når sporet er for tynt', () => {
		const points = track([{ seconds: 20, speedMs: 3, sampleSeconds: 4 }]);
		expect(points.length).toBeLessThan(MIN_POINTS);

		expect(computeMovingTime(points, { sportType: 'running' })).toBeNull();
	});

	it('returnerer null når dekningen er for dårlig til å si noe', () => {
		// Ti punkter tett i starten, så et hull på en time. Hullet krediteres
		// høyst ett minutt, så dekningen faller under gulvet.
		const points = track([{ seconds: 40, speedMs: 3, sampleSeconds: 4 }]);
		points.push({
			lat: 59.95,
			lon: 10.75,
			time: new Date(START + 3600 * 1000).toISOString()
		});

		expect(computeMovingTime(points, { sportType: 'running' })).toBeNull();
	});

	it('ignorerer punkter uten posisjon eller tid', () => {
		const points = track([{ seconds: 600, speedMs: 3 }]);
		const withJunk: MovingTimePoint[] = [
			{ lat: null, lon: 10.75, time: new Date(START).toISOString() },
			{ lat: 59.9, lon: 10.75, time: null },
			{ lat: 59.9, lon: 10.75, time: 'ikke en dato' },
			...points
		];

		const clean = computeMovingTime(points, { sportType: 'running' });
		const dirty = computeMovingTime(withJunk, { sportType: 'running' });

		expect(dirty).toEqual(clean);
	});

	it('sorterer punkter som kommer i feil rekkefølge', () => {
		const points = track([{ seconds: 600, speedMs: 3 }]);
		const shuffled = [...points].reverse();

		expect(computeMovingTime(shuffled, { sportType: 'running' })).toEqual(
			computeMovingTime(points, { sportType: 'running' })
		);
	});

	it('teller ikke innendørs GPS-drift i en garasje som sykling', () => {
		// Halen er ikke stillstand: telefonen ligger i en garasje der multipath
		// kaster posisjonen titalls meter av gårde. Over ti sekunder ser det ut
		// som fart — det er den grove porten som avslører at man ikke kom noen vei.
		const points = track([
			{ seconds: 1500, speedMs: 6 },
			{ seconds: 1800, speedMs: 0, jitterMeters: 40 }
		]);

		const result = computeMovingTime(points, { sportType: 'e_bike' });

		expect(result).not.toBeNull();
		expect(result!.movingSeconds).toBeGreaterThan(1400);
		expect(result!.movingSeconds).toBeLessThan(1700);
	});

	it('teller ikke gåturen opp på kontoret som sykling', () => {
		// Etter garasjen bæres telefonen inn. Gange på 1,4 m/s kommer faktisk
		// noen vei, så den grove porten slipper den gjennom — det er terskelen
		// for sportsfamilien som skiller den fra sykling.
		const points = track([
			{ seconds: 1500, speedMs: 6 },
			{ seconds: 300, speedMs: 1.4 }
		]);

		const result = computeMovingTime(points, { sportType: 'e_bike' });

		expect(result).not.toBeNull();
		expect(result!.movingSeconds).toBeGreaterThan(1400);
		expect(result!.movingSeconds).toBeLessThan(1600);
	});

	it('krediterer hele turen når den samme gangfarten ER sporten', () => {
		const points = track([{ seconds: 1800, speedMs: 1.4 }]);

		const result = computeMovingTime(points, { sportType: 'walking' });

		expect(result!.movingSeconds).toBeGreaterThan(1700);
	});

	it('bruker terskelen til sportsfamilien, ikke en felles', () => {
		// 1 m/s: over gange-terskelen, under sykkel-terskelen.
		const points = track([{ seconds: 1200, speedMs: 1 }]);

		const walking = computeMovingTime(points, { sportType: 'walking' });
		const cycling = computeMovingTime(points, { sportType: 'cycling' });

		expect(walking!.movingSeconds).toBeGreaterThan(1100);
		expect(cycling!.movingSeconds).toBe(0);
		expect(MOVING_THRESHOLD_MS_BY_FAMILY.walking).toBeLessThan(
			MOVING_THRESHOLD_MS_BY_FAMILY.cycling
		);
	});

	it('overstiger aldri elapsed', () => {
		const points = track([{ seconds: 3600, speedMs: 8, sampleSeconds: 1 }]);

		const result = computeMovingTime(points, { sportType: 'cycling' });

		expect(result!.movingSeconds).toBeLessThanOrEqual(result!.elapsedSeconds);
	});
});
