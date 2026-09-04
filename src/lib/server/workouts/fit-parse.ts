/**
 * FIT → `ParsedWorkout`, med Garmins egen SDK.
 *
 * 305 av 1020 filer i Strava-eksporten er `.fit.gz`. FIT er et binærformat med
 * definisjonsmeldinger og globale meldingsnumre — ikke noe man leser med en
 * regex, slik GPX og TCX blir i `dropbox-sync.ts`. Derfor SDK-en framfor en
 * parser skrevet fra spec: formatet har et hundretall meldingstyper, og en
 * halvveis egen parser feiler på nettopp de filene som er verdt å importere.
 *
 * **Denne modulen leser SPORET, ikke metadataen.** Sport, distanse og varighet
 * kommer fra `activities.csv` (se `$lib/domain/health/strava-export.ts`) —
 * manifestet er Stravas egne tall, regnet av kilden som eide økta. FIT-filas
 * egen `session`-melding brukes bare som fallback når manifestet mangler noe.
 */

import { Decoder, Stream } from '@garmin/fitsdk';
import { computeElevationGain, type ParsedWorkout, type TrackPoint } from '$lib/server/integrations/dropbox-sync';

/**
 * Semisirkler → grader.
 *
 * FIT lagrer posisjon som 32-bits heltall der hele sirkelen er 2^32, og
 * SDK-en gjør IKKE denne konverteringen — `positionLat` kommer tilbake som
 * 714754141 der svaret er 59,91. Glemmer man den, blir hvert punkt liggende
 * langt utenfor kartet, og et spor uten gyldige koordinater ser ut som en fil
 * uten spor. Målt på en fil kodet med SDK-ens egen Encoder.
 */
export const SEMICIRCLES_TO_DEGREES = 180 / 2 ** 31;

/** Utenfor dette er tallet ikke en koordinat. */
function plausibleLat(value: number): boolean {
	return Number.isFinite(value) && value >= -90 && value <= 90;
}
function plausibleLon(value: number): boolean {
	return Number.isFinite(value) && value >= -180 && value <= 180;
}

type FitRecord = {
	timestamp?: Date | number;
	positionLat?: number;
	positionLong?: number;
	altitude?: number;
	enhancedAltitude?: number;
	heartRate?: number;
	distance?: number;
};

type FitSession = {
	startTime?: Date | number;
	sport?: string;
	totalElapsedTime?: number;
	totalTimerTime?: number;
	totalDistance?: number;
};

function toDate(value: Date | number | undefined): Date | null {
	if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
	if (typeof value === 'number' && Number.isFinite(value)) return new Date(value);
	return null;
}

function toFiniteNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export class FitParseError extends Error {}

/**
 * Dekoder en FIT-fil til sporform.
 *
 * Kaster `FitParseError` når bytene ikke er FIT eller integritetssjekken
 * feiler — en gzip som pakket ut til noe annet enn en øktfil skal si det, ikke
 * gi et tomt spor som ser ut som en økt uten GPS.
 */
export function parseFit(bytes: Uint8Array): ParsedWorkout | null {
	const stream = Stream.fromByteArray(bytes);
	const decoder = new Decoder(stream);

	if (!decoder.isFIT()) throw new FitParseError('Fila er ikke en FIT-fil.');
	if (!decoder.checkIntegrity()) throw new FitParseError('FIT-fila er skadet (integritetssjekk feilet).');

	const { messages } = decoder.read() as {
		messages: { recordMesgs?: FitRecord[]; sessionMesgs?: FitSession[] };
	};

	const records = messages.recordMesgs ?? [];
	const session = messages.sessionMesgs?.[0];

	const points: TrackPoint[] = [];
	const hrValues: number[] = [];
	let lastCumulativeDistance: number | undefined;

	for (const record of records) {
		// **Puls samles uavhengig av posisjon.** En innendørsøkt (tredemølle) har
		// puls og ingen GPS, og en `points`-basert innsamling ville gitt en økt
		// uten pulskurve der fila hadde en perfekt en.
		const hr = toFiniteNumber(record.heartRate);
		if (hr != null && hr > 0) hrValues.push(hr);

		const cumulative = toFiniteNumber(record.distance);
		if (cumulative != null) lastCumulativeDistance = cumulative;

		if (record.positionLat == null || record.positionLong == null) continue;
		const lat = record.positionLat * SEMICIRCLES_TO_DEGREES;
		const lon = record.positionLong * SEMICIRCLES_TO_DEGREES;
		if (!plausibleLat(lat) || !plausibleLon(lon)) continue;

		const time = toDate(record.timestamp);
		points.push({
			lat,
			lon,
			ele: toFiniteNumber(record.enhancedAltitude) ?? toFiniteNumber(record.altitude),
			hr: hr != null && hr > 0 ? hr : undefined,
			time: time ? time.toISOString() : undefined
		});
	}

	// En fil uten spor OG uten puls bærer ingenting manifestet ikke alt har.
	if (points.length < 2 && hrValues.length === 0) return null;

	const startTime =
		toDate(session?.startTime) ??
		(points.find((p) => p.time)?.time ? new Date(points.find((p) => p.time)!.time!) : null) ??
		toDate(records.find((r) => r.timestamp)?.timestamp);

	if (!startTime) throw new FitParseError('FIT-fila har ingen tidsstempler.');

	const lastTime = [...points].reverse().find((p) => p.time)?.time;
	const fromTrack = lastTime
		? Math.max(0, Math.round((new Date(lastTime).getTime() - startTime.getTime()) / 1000))
		: 0;

	// `totalElapsedTime` er FITs elapsed, som er det effort skåres på — samme
	// felt `data.duration` bærer ellers. `totalTimerTime` er bevegelsestid og
	// hører ikke her; blandes de, prises en tur med et langt stopp som kortere
	// enn den var, og «glemte trackeren»-forslaget kan ikke lenger se feilen.
	const duration = toFiniteNumber(session?.totalElapsedTime) ?? fromTrack;

	return {
		// Manifestet overstyrer dette. FITs egen sport er fallback for en fil
		// importert utenfor Strava-flyten.
		sportType: session?.sport ?? 'workout',
		startTime,
		duration: Math.round(duration),
		distance: toFiniteNumber(session?.totalDistance) ?? lastCumulativeDistance ?? 0,
		elevation: computeElevationGain(points),
		avgHeartRate: hrValues.length
			? Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length)
			: undefined,
		maxHeartRate: hrValues.length ? Math.max(...hrValues) : undefined,
		minHeartRate: hrValues.length ? Math.min(...hrValues) : undefined,
		trackPoints: points,
		sourceFormat: 'fit'
	};
}
