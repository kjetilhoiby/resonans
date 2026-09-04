import { describe, it, expect } from 'vitest';
import { Encoder, Profile } from '@garmin/fitsdk';
import { describeFitContents, FitParseError, parseFit, SEMICIRCLES_TO_DEGREES } from './fit-parse';

const START = new Date('2019-08-02T06:18:02.000Z');

/** `parseFit` gir nå diagnose ved siden av resultatet; de fleste testene vil økta. */
function workoutFrom(bytes: Uint8Array) {
	return parseFit(bytes).workout;
}

function toSemicircles(degrees: number): number {
	return Math.round(degrees / SEMICIRCLES_TO_DEGREES);
}

/**
 * Bygger en ekte FIT-fil med SDK-ens Encoder.
 *
 * Testen går altså mot BYTES, ikke mot et mocket dekoderesultat — den ville
 * ellers ikke fanget semisirkel-konverteringen, som er den ene feilen som gjør
 * hele sporet ubrukelig.
 */
function buildFit(
	records: Array<{ lat?: number; lon?: number; ele?: number; hr?: number; dist?: number; afterSeconds: number }>,
	session?: Record<string, unknown>
): Uint8Array {
	const enc = new Encoder();
	enc.onMesg(Profile.MesgNum.FILE_ID, {
		type: 'activity',
		timeCreated: START,
		manufacturer: 'garmin'
	} as never);
	for (const r of records) {
		const mesg: Record<string, unknown> = { timestamp: new Date(START.getTime() + r.afterSeconds * 1000) };
		if (r.lat != null) mesg.positionLat = toSemicircles(r.lat);
		if (r.lon != null) mesg.positionLong = toSemicircles(r.lon);
		if (r.ele != null) mesg.altitude = r.ele;
		if (r.hr != null) mesg.heartRate = r.hr;
		if (r.dist != null) mesg.distance = r.dist;
		enc.onMesg(Profile.MesgNum.RECORD, mesg as never);
	}
	if (session) {
		// SDK-ens `Mesg`-type erklærer ikke felt per meldingstype, så et
		// sesjonsobjekt bygget her må castes. Encoderen validerer feltnavnene
		// selv ved koding — en skrivefeil kommer ut som en manglende verdi i
		// dekodingen, ikke som en typefeil.
		enc.onMesg(Profile.MesgNum.SESSION, { timestamp: START, startTime: START, ...session } as never);
	}
	return enc.close();
}

describe('parseFit — koordinater', () => {
	it('konverterer semisirkler til grader', () => {
		const bytes = buildFit([
			{ lat: 59.91, lon: 10.75, afterSeconds: 0 },
			{ lat: 59.92, lon: 10.76, afterSeconds: 60 }
		]);
		const parsed = workoutFrom(bytes);
		expect(parsed).not.toBeNull();
		expect(parsed!.trackPoints[0].lat).toBeCloseTo(59.91, 4);
		expect(parsed!.trackPoints[0].lon).toBeCloseTo(10.75, 4);
	});

	it('gir IKKE tilbake råverdien i semisirkler', () => {
		const parsed = workoutFrom(
			buildFit([
				{ lat: 59.91, lon: 10.75, afterSeconds: 0 },
				{ lat: 59.92, lon: 10.76, afterSeconds: 60 }
			])
		);
		// 59,91 grader er ~714 754 141 semisirkler. Slipper den gjennom, ligger
		// hvert punkt utenfor kartet og sporet ser tomt ut.
		expect(parsed!.trackPoints[0].lat).toBeLessThan(90);
	});

	it('hopper over punkter uten posisjon framfor å tegne dem på nullmeridianen', () => {
		const parsed = workoutFrom(
			buildFit([
				{ lat: 59.91, lon: 10.75, afterSeconds: 0 },
				{ hr: 150, afterSeconds: 30 },
				{ lat: 59.92, lon: 10.76, afterSeconds: 60 }
			])
		);
		expect(parsed!.trackPoints).toHaveLength(2);
	});
});

describe('parseFit — puls', () => {
	it('samler puls uavhengig av posisjon, så en tredemølleøkt får pulskurve', () => {
		const parsed = workoutFrom(
			buildFit([
				{ hr: 140, afterSeconds: 0 },
				{ hr: 150, afterSeconds: 60 },
				{ hr: 160, afterSeconds: 120 }
			])
		);
		expect(parsed).not.toBeNull();
		expect(parsed!.trackPoints).toHaveLength(0);
		expect(parsed!.avgHeartRate).toBe(150);
		expect(parsed!.maxHeartRate).toBe(160);
		expect(parsed!.minHeartRate).toBe(140);
	});

	it('lar pulsen stå udømt — vakta i hr-artefacts eier den vurderingen', () => {
		// 230 er over MAX_PLAUSIBLE_HR, men parseren skal RAPPORTERE, ikke
		// forkaste: forkastingen skjer i analyzeWorkout, som ser hele kurven og
		// måler ANDELEN artefakter.
		const parsed = workoutFrom(
			buildFit([
				{ hr: 230, afterSeconds: 0 },
				{ hr: 230, afterSeconds: 60 }
			])
		);
		expect(parsed!.maxHeartRate).toBe(230);
	});
});

describe('parseFit — varighet og distanse', () => {
	it('bruker sesjonens ELAPSED, ikke bevegelsestida', () => {
		const parsed = workoutFrom(
			buildFit(
				[
					{ lat: 59.91, lon: 10.75, afterSeconds: 0 },
					{ lat: 59.92, lon: 10.76, afterSeconds: 600 }
				],
				{ totalElapsedTime: 3600, totalTimerTime: 900, sport: 'cycling', totalDistance: 12500 }
			)
		);
		// Effort skåres på elapsed. Leses timerTime her, prises en tur med et
		// langt stopp som kortere enn den var.
		expect(parsed!.duration).toBe(3600);
		expect(parsed!.distance).toBe(12500);
	});

	it('faller tilbake på sporets tidsspenn når sesjonen mangler', () => {
		const parsed = workoutFrom(
			buildFit([
				{ lat: 59.91, lon: 10.75, afterSeconds: 0 },
				{ lat: 59.92, lon: 10.76, afterSeconds: 900 }
			])
		);
		expect(parsed!.duration).toBe(900);
	});

	it('faller tilbake på siste kumulative distanse fra punktene', () => {
		const parsed = workoutFrom(
			buildFit([
				{ lat: 59.91, lon: 10.75, dist: 0, afterSeconds: 0 },
				{ lat: 59.92, lon: 10.76, dist: 5000, afterSeconds: 600 }
			])
		);
		expect(parsed!.distance).toBe(5000);
	});
});

describe('parseFit — avvisning', () => {
	it('kaster på bytes som ikke er FIT framfor å gi et tomt spor', () => {
		expect(() => parseFit(new TextEncoder().encode('dette er ikke en FIT-fil'))).toThrow(FitParseError);
	});

	it('gir null for en fil uten både spor og puls', () => {
		expect(workoutFrom(buildFit([{ afterSeconds: 0 }, { afterSeconds: 60 }]))).toBeNull();
	});

	it('merker kilden som fit', () => {
		const parsed = workoutFrom(
			buildFit([
				{ lat: 59.91, lon: 10.75, afterSeconds: 0 },
				{ lat: 59.92, lon: 10.76, afterSeconds: 60 }
			])
		);
		expect(parsed!.sourceFormat).toBe('fit');
	});
});

describe('describeFitContents — «ingen brukbart spor» skjulte tre tilstander', () => {
	it('skiller en fil uten tidsserie fra en med punkter', () => {
		// Bare et sammendrag: Strava-eksporten hadde fire tredemølleøkter fra
		// 2026 og to turer fra 2014 i denne sekkeposten, og rapporten kunne
		// ikke si om det var dataene eller parseren.
		const bareSession = parseFit(
			buildFit([], { sport: 'running', totalElapsedTime: 1800, totalDistance: 5000 })
		);
		expect(bareSession.workout).toBeNull();
		expect(bareSession.contents.records).toBe(0);
		expect(describeFitContents(bareSession.contents)).toBe('bare sammendrag, ingen tidsserie');
	});

	it('sier «uten posisjon og uten puls» for punkter uten noe av verdi', () => {
		const result = parseFit(buildFit([{ afterSeconds: 0 }, { afterSeconds: 60 }]));
		expect(result.workout).toBeNull();
		expect(result.contents.records).toBe(2);
		expect(result.contents.withPosition).toBe(0);
		expect(result.contents.withHeartRate).toBe(0);
		expect(describeFitContents(result.contents)).toContain('uten posisjon og uten puls');
	});

	it('teller posisjon og puls hver for seg — en tredemølleøkt har puls, ikke GPS', () => {
		const result = parseFit(
			buildFit([
				{ hr: 140, afterSeconds: 0 },
				{ hr: 150, afterSeconds: 60 },
				{ hr: 160, afterSeconds: 120 }
			])
		);
		// Den GIR en økt, nettopp fordi pulsen er verdt å ha uten GPS.
		expect(result.workout).not.toBeNull();
		expect(result.contents.withPosition).toBe(0);
		expect(result.contents.withHeartRate).toBe(3);
	});

	it('teller bare punkter med GYLDIG posisjon', () => {
		const result = parseFit(
			buildFit([
				{ lat: 59.91, lon: 10.75, afterSeconds: 0 },
				{ hr: 150, afterSeconds: 30 },
				{ lat: 59.92, lon: 10.76, afterSeconds: 60 }
			])
		);
		expect(result.contents.records).toBe(3);
		expect(result.contents.withPosition).toBe(2);
	});

	it('rapporterer også når fila ga en økt', () => {
		const result = parseFit(
			buildFit([
				{ lat: 59.91, lon: 10.75, hr: 140, afterSeconds: 0 },
				{ lat: 59.92, lon: 10.76, hr: 150, afterSeconds: 60 }
			])
		);
		expect(result.workout).not.toBeNull();
		expect(describeFitContents(result.contents)).toBe('2 punkter (2 med posisjon, 2 med puls)');
	});
});
