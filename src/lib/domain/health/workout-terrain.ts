/**
 * Bakker og runder utledet av GPS-sporet.
 *
 * Se `docs/changelog/2026-08-10-oktvurdering-med-terreng-og-mal.md`.
 *
 * Dette er den *navnløse* halvdelen av terrengforståelsen: «stigningen fra km 2,1
 * til km 2,6». Den navngitte halvdelen — «Dreperen», «Grønland til Vålerenga» —
 * kan ikke utledes og kommer fra Ekko (`workout-analysis.ts`). Arbeidsdelingen er
 * ikke tilfeldig: Ekkos egen `RunFeature`-modell sier det rett ut om strekk, at de
 * «finnes i historikken og i hodet», og at ingen terrengterskel kan finne dem.
 *
 * Det en terskel *kan* finne er en motbakke og en runde, og det er nettopp de to
 * som gjør en økt lesbar uten at brukeren har definert noe på forhånd.
 *
 * Modulen er ren: den tar punkter og returnerer strekninger. Ingen DB, ingen tid.
 */

import { cumulativeDistanceMeters, haversineMeters, type TrackPoint } from '$lib/utils/track-stats';

/** En sammenhengende stigning. Avstander i meter fra start av økta. */
export type Climb = {
	startDistanceM: number;
	endDistanceM: number;
	lengthM: number;
	gainM: number;
	/** Snittstigning i prosent over hele dragets lengde. */
	avgGradientPct: number;
	durationSec: number | null;
	avgPaceSecPerKm: number | null;
	avgHr: number | null;
	maxHr: number | null;
};

/** En runde: sporet har kommet tilbake i nærheten av der runden startet. */
export type Lap = {
	index: number;
	distanceM: number;
	durationSec: number | null;
	avgPaceSecPerKm: number | null;
	avgHr: number | null;
};

/**
 * Minste høydemeter et drag må ha for å telle som bakke.
 *
 * GPS-høyde er den støyeste kanalen vi har — barometerløse telefoner spriker
 * lett 5–10 meter i ro. Ti meter er derfor ikke «en liten bakke», det er
 * grensa for at vi i det hele tatt tror på tallet.
 */
export const MIN_CLIMB_GAIN_M = 10;

/** Under dette er det en fartsdump, ikke en bakke det gir mening å snakke om. */
export const MIN_CLIMB_LENGTH_M = 100;

/**
 * Snittstigning under dette leses ikke som motbakke av beina.
 * 3 % er ~1,7 grader — merkbart i tempo, men ikke dramatisk.
 */
export const MIN_CLIMB_GRADIENT_PCT = 3;

/**
 * Hvor mye høyde et drag kan MISTE underveis uten å bli delt i to.
 *
 * Uten denne blir en lang bakke med et flatt platå til tre korte bakker, og
 * lista blir ubrukelig nettopp på de stigningene som er verdt å nevne. Fem
 * meter er valgt i samme størrelsesorden som GPS-støyen selv.
 */
export const CLIMB_DIP_TOLERANCE_M = 5;

/**
 * Glattevindu for høydeprofilen, i meter langs sporet.
 *
 * Høyde glattes over DISTANSE, ikke over punkter: et spor har tettere punkter
 * når man går sakte, så et punktvindu ville glattet hardest nettopp i bakkene.
 */
export const ELEVATION_SMOOTHING_M = 30;

function parseTimeMs(point: TrackPoint): number | null {
	if (!point.time) return null;
	const t = new Date(point.time).getTime();
	return Number.isFinite(t) ? t : null;
}

/**
 * Glatter høyden over et distansevindu. Returnerer én verdi per punkt, eller
 * null der høyde mangler helt.
 */
export function smoothElevation(
	points: TrackPoint[],
	cum: number[],
	windowM = ELEVATION_SMOOTHING_M
): Array<number | null> {
	const raw = points.map((p) => (typeof p.ele === 'number' && Number.isFinite(p.ele) ? p.ele : null));
	if (raw.every((v) => v === null)) return raw;

	const half = windowM / 2;
	const out: Array<number | null> = new Array(points.length).fill(null);
	let lo = 0;
	let hi = 0;
	let sum = 0;
	let count = 0;

	for (let i = 0; i < points.length; i++) {
		while (hi < points.length && cum[hi] <= cum[i] + half) {
			if (raw[hi] !== null) {
				sum += raw[hi] as number;
				count += 1;
			}
			hi += 1;
		}
		while (lo < points.length && cum[lo] < cum[i] - half) {
			if (raw[lo] !== null) {
				sum -= raw[lo] as number;
				count -= 1;
			}
			lo += 1;
		}
		out[i] = count > 0 ? sum / count : raw[i];
	}

	return out;
}

function averageHr(points: TrackPoint[], from: number, to: number): { avg: number | null; max: number | null } {
	let sum = 0;
	let count = 0;
	let max: number | null = null;
	for (let i = from; i <= to && i < points.length; i++) {
		const hr = points[i].hr;
		if (typeof hr !== 'number' || !Number.isFinite(hr) || hr <= 0) continue;
		sum += hr;
		count += 1;
		if (max === null || hr > max) max = hr;
	}
	return { avg: count > 0 ? Math.round(sum / count) : null, max };
}

function elapsedSec(points: TrackPoint[], from: number, to: number): number | null {
	const t0 = parseTimeMs(points[from]);
	const t1 = parseTimeMs(points[to]);
	if (t0 === null || t1 === null) return null;
	const sec = (t1 - t0) / 1000;
	return sec > 0 ? sec : null;
}

/**
 * Finner sammenhengende stigninger i sporet.
 *
 * Algoritmen er bevisst enkel: gå framover gjennom den glattede høydeprofilen,
 * hold på et pågående drag så lenge høyden ikke har falt mer enn
 * `CLIMB_DIP_TOLERANCE_M` under dragets toppunkt, og avslutt draget der. Et
 * avsluttet drag beholdes bare hvis det består alle tre tersklene.
 *
 * Draget måles til sitt eget TOPPUNKT, ikke til der falltoleransen løp ut —
 * ellers ville hver bakke fått med seg de første metrene av utforkjøringen, og
 * både lengde og snittstigning blitt feil.
 */
export function detectClimbs(points: TrackPoint[]): Climb[] {
	if (points.length < 2) return [];
	const cum = cumulativeDistanceMeters(points);
	const ele = smoothElevation(points, cum);
	if (ele.every((v) => v === null)) return [];

	const climbs: Climb[] = [];
	let startIdx: number | null = null;
	let peakIdx = 0;
	let peakEle = -Infinity;

	const closeClimb = () => {
		if (startIdx === null) return;
		const from = startIdx;
		const to = peakIdx;
		startIdx = null;
		if (to <= from) return;

		const startEle = ele[from];
		const endEle = ele[to];
		if (startEle === null || endEle === null) return;

		const lengthM = cum[to] - cum[from];
		const gainM = endEle - startEle;
		if (gainM < MIN_CLIMB_GAIN_M || lengthM < MIN_CLIMB_LENGTH_M) return;
		const avgGradientPct = (gainM / lengthM) * 100;
		if (avgGradientPct < MIN_CLIMB_GRADIENT_PCT) return;

		const durationSec = elapsedSec(points, from, to);
		const { avg, max } = averageHr(points, from, to);
		climbs.push({
			startDistanceM: Math.round(cum[from]),
			endDistanceM: Math.round(cum[to]),
			lengthM: Math.round(lengthM),
			gainM: Math.round(gainM),
			avgGradientPct: Math.round(avgGradientPct * 10) / 10,
			durationSec: durationSec === null ? null : Math.round(durationSec),
			avgPaceSecPerKm:
				durationSec !== null && lengthM > 0 ? Math.round(durationSec / (lengthM / 1000)) : null,
			avgHr: avg,
			maxHr: max
		});
	};

	for (let i = 0; i < points.length; i++) {
		const current = ele[i];
		if (current === null) continue;

		if (startIdx === null) {
			startIdx = i;
			peakIdx = i;
			peakEle = current;
			continue;
		}

		if (current > peakEle) {
			peakEle = current;
			peakIdx = i;
			continue;
		}

		if (peakEle - current > CLIMB_DIP_TOLERANCE_M) {
			closeClimb();
			// Nytt drag starter der forrige sluttet å stige — bunnen vi står i nå.
			startIdx = i;
			peakIdx = i;
			peakEle = current;
		}
	}
	closeClimb();

	return climbs;
}

/**
 * Hvor nær startpunktet sporet må komme for at en runde regnes som fullført.
 *
 * Trettifem meter er bredere enn GPS-feilen og smalere enn to parallelle veier.
 * Går man samme sti tilbake, skal det ikke telle som runde.
 */
export const LAP_RADIUS_M = 35;

/**
 * Korteste runde vi tror på. Under dette er man på en parkeringsplass, ikke på
 * en bane — og en for lav grense gjør at et enkelt frem-og-tilbake blir «runder».
 */
export const MIN_LAP_DISTANCE_M = 300;

/**
 * Finner runder: hver gang sporet kommer tilbake innenfor `LAP_RADIUS_M` av der
 * inneværende runde startet, etter å ha vært minst `MIN_LAP_DISTANCE_M` unna.
 *
 * Ankeret flyttes til punktet runden faktisk ble lukket i, ikke til øktas start.
 * Ellers ville en bane man løper inn på etter to kilometer gitt runder som
 * driver i lengde for hver omgang.
 *
 * Siste, ufullførte runde tas ikke med — en halv runde er ikke en rundetid.
 */
export function detectLaps(points: TrackPoint[]): Lap[] {
	if (points.length < 3) return [];
	const cum = cumulativeDistanceMeters(points);
	const laps: Lap[] = [];

	let anchorIdx = 0;
	let leftAnchor = false;

	for (let i = 1; i < points.length; i++) {
		const distanceFromAnchor = cum[i] - cum[anchorIdx];
		const straightLine = haversineMeters(points[anchorIdx], points[i]);

		if (!leftAnchor) {
			if (distanceFromAnchor >= MIN_LAP_DISTANCE_M && straightLine > LAP_RADIUS_M) {
				leftAnchor = true;
			}
			continue;
		}

		if (straightLine <= LAP_RADIUS_M) {
			const durationSec = elapsedSec(points, anchorIdx, i);
			const { avg } = averageHr(points, anchorIdx, i);
			laps.push({
				index: laps.length + 1,
				distanceM: Math.round(distanceFromAnchor),
				durationSec: durationSec === null ? null : Math.round(durationSec),
				avgPaceSecPerKm:
					durationSec !== null && distanceFromAnchor > 0
						? Math.round(durationSec / (distanceFromAnchor / 1000))
						: null,
				avgHr: avg
			});
			anchorIdx = i;
			leftAnchor = false;
		}
	}

	// Én «runde» er bare en tur som endte der den startet. To eller flere er en bane.
	return laps.length >= 2 ? laps : [];
}
