import {
	hrZoneBands,
	HR_ZONE_LABELS,
	type HrZoneNumber
} from '$lib/domain/health/hr-zones';

export interface TrackPoint {
	lat: number;
	lon: number;
	time?: string | null;
	ele?: number | null;
	hr?: number | null;
}

export interface SeriesPoint {
	distanceKm: number;
	value: number;
}

export interface KmSplit {
	kmIndex: number;
	isPartial: boolean;
	distanceKm: number;
	durationSec: number;
	paceSecondsPerKm: number;
	avgHr: number | null;
	elevationGainM: number;
}

export interface HrBand {
	label: string;
	minBpm: number;
	maxBpm: number;
	color: string;
	seconds: number;
}

/**
 * Sonefargene, indeksert på sonenummer (1–5). Kald→varm er innarbeidet
 * sone-semantikk; samme skala som Ekkos `EkkoTheme.zone`.
 */
export const HR_ZONE_COLORS: Record<HrZoneNumber, string> = {
	1: '#60a5fa',
	2: '#34d399',
	3: '#fbbf24',
	4: '#fb923c',
	5: '#ef4444'
};

/**
 * Pulsbånd i bpm fra brukerens baseline — **eneste vei til et bånd her**.
 *
 * ## Hva som sto her før
 *
 * En hardkodet liste: `Rolig 0–120`, `Lett 120–140`, `Moderat 140–160`,
 * `Hard 160–180`, `Maks 180+`. Like for alle, uavhengig av maks- og hvilepuls —
 * altså en TREDJE sonemodell ved siden av serverens HRR og (fram til august
 * 2026) Ekkos %makspuls. Verre: den brukte de samme norske ordene, så med maks
 * 180 og hvile 50 var puls 135 «Lett» på øktdetaljen og «Rolig» (sone 2) i
 * sonekortet ved siden av. Tre navn på ett hjerteslag.
 *
 * Den ble stående da de to andre ble konsolidert, fordi den ikke het noe med
 * «zone» og ikke lå i helse-domenet. Et søk på `HeartRateZone` fant den ikke.
 *
 * Returnerer `null` uten brukbar baseline. Flaten skal da si at sonene mangler,
 * ikke tegne et bånd av gjettede tall: et gjettet bånd ser like autoritativt ut
 * som et ekte.
 */
export function hrBandsFromBaseline(
	baseline: { restHr: number; maxHr: number } | null | undefined
): Omit<HrBand, 'seconds'>[] | null {
	if (!baseline) return null;
	const bands = hrZoneBands(baseline);
	if (!bands) return null;
	return bands.map((band) => ({
		label: `${HR_ZONE_LABELS[band.zone]} (Z${band.zone})`,
		// **Z1 starter på 0, ikke på hvilepulsen.** `zoneForHeartRate` legger en
		// puls under hvile i Z1; gjorde vi ikke det samme her, falt den ut av ALLE
		// bånd (`computeHrDistribution` bryter på første treff og har ingen
		// oppsamling), og stille ut av totalen. Det skjer hver gang man står i ro.
		minBpm: band.zone === 1 ? 0 : band.lowerBpm,
		// `computeHrDistribution` bruker `hr < maxBpm`, mens sonebåndene er
		// inklusive i begge ender. +1 her framfor å endre sammenligningen: da
		// hadde de to måttet holdes i sync, og det er dét som går galt.
		maxBpm: band.zone === 5 ? 999 : band.upperBpm + 1,
		color: HR_ZONE_COLORS[band.zone]
	}));
}

export function haversineMeters(a: TrackPoint, b: TrackPoint): number {
	const R = 6371000;
	const dLat = ((b.lat - a.lat) * Math.PI) / 180;
	const dLon = ((b.lon - a.lon) * Math.PI) / 180;
	const sinDLat = Math.sin(dLat / 2);
	const sinDLon = Math.sin(dLon / 2);
	const h =
		sinDLat * sinDLat +
		Math.cos((a.lat * Math.PI) / 180) *
			Math.cos((b.lat * Math.PI) / 180) *
			sinDLon *
			sinDLon;
	return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function cumulativeDistanceMeters(points: TrackPoint[]): number[] {
	if (points.length === 0) return [];
	const result = new Array<number>(points.length);
	result[0] = 0;
	for (let i = 1; i < points.length; i++) {
		result[i] = result[i - 1] + haversineMeters(points[i - 1], points[i]);
	}
	return result;
}

function parseTime(p: TrackPoint): number | null {
	if (!p.time) return null;
	const t = new Date(p.time).getTime();
	return Number.isFinite(t) ? t : null;
}

export function computeSpeedSeries(
	points: TrackPoint[],
	smoothingWindowSec = 20
): SeriesPoint[] {
	if (points.length < 2) return [];

	const cum = cumulativeDistanceMeters(points);
	const times = points.map(parseTime);

	interface Segment {
		midDistKm: number;
		midTimeMs: number;
		durationSec: number;
		speedKmh: number;
	}

	const segments: Segment[] = [];
	for (let i = 1; i < points.length; i++) {
		const t0 = times[i - 1];
		const t1 = times[i];
		if (t0 == null || t1 == null) continue;
		const dt = (t1 - t0) / 1000;
		const dd = cum[i] - cum[i - 1];
		if (dt <= 0 || dd < 0) continue;
		segments.push({
			midDistKm: (cum[i - 1] + cum[i]) / 2 / 1000,
			midTimeMs: (t0 + t1) / 2,
			durationSec: dt,
			speedKmh: (dd / dt) * 3.6
		});
	}

	if (segments.length === 0) return [];

	const half = (smoothingWindowSec * 1000) / 2;
	const result: SeriesPoint[] = [];
	let lo = 0;
	let hi = 0;
	for (let i = 0; i < segments.length; i++) {
		const center = segments[i].midTimeMs;
		while (lo < segments.length && segments[lo].midTimeMs < center - half) lo++;
		while (hi < segments.length && segments[hi].midTimeMs <= center + half) hi++;
		let weightedSum = 0;
		let weightTotal = 0;
		for (let j = lo; j < hi; j++) {
			const w = segments[j].durationSec;
			weightedSum += segments[j].speedKmh * w;
			weightTotal += w;
		}
		const value = weightTotal > 0 ? weightedSum / weightTotal : segments[i].speedKmh;
		result.push({ distanceKm: segments[i].midDistKm, value });
	}
	return result;
}

export function computeElevationSeries(points: TrackPoint[]): SeriesPoint[] {
	if (points.length < 2) return [];
	const cum = cumulativeDistanceMeters(points);
	const result: SeriesPoint[] = [];
	for (let i = 0; i < points.length; i++) {
		if (typeof points[i].ele === 'number') {
			result.push({ distanceKm: cum[i] / 1000, value: points[i].ele as number });
		}
	}
	return result;
}

export function computeKmSplits(points: TrackPoint[]): KmSplit[] {
	if (points.length < 2) return [];
	const cum = cumulativeDistanceMeters(points);
	const times = points.map(parseTime);
	const totalMeters = cum[cum.length - 1];
	if (totalMeters < 100) return [];

	const splits: KmSplit[] = [];
	const numFullKm = Math.floor(totalMeters / 1000);

	function interpolateAtMeters(targetM: number): { timeMs: number | null; index: number } {
		for (let i = 1; i < cum.length; i++) {
			if (cum[i] >= targetM) {
				const frac = (targetM - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-6);
				const t0 = times[i - 1];
				const t1 = times[i];
				if (t0 == null || t1 == null) return { timeMs: null, index: i };
				return { timeMs: t0 + (t1 - t0) * frac, index: i };
			}
		}
		const last = times[times.length - 1];
		return { timeMs: last, index: cum.length - 1 };
	}

	function avgHrBetween(startIdx: number, endIdx: number): number | null {
		let sum = 0;
		let count = 0;
		for (let i = startIdx; i <= endIdx && i < points.length; i++) {
			if (typeof points[i].hr === 'number') {
				sum += points[i].hr as number;
				count++;
			}
		}
		return count > 0 ? sum / count : null;
	}

	function elevationGainBetween(startIdx: number, endIdx: number): number {
		let gain = 0;
		for (let i = startIdx + 1; i <= endIdx && i < points.length; i++) {
			const a = points[i - 1].ele;
			const b = points[i].ele;
			if (typeof a === 'number' && typeof b === 'number' && b > a) {
				gain += b - a;
			}
		}
		return gain;
	}

	let prevTimeMs = times[0];
	let prevIdx = 0;
	for (let k = 1; k <= numFullKm; k++) {
		const { timeMs, index } = interpolateAtMeters(k * 1000);
		const dur =
			prevTimeMs != null && timeMs != null ? (timeMs - prevTimeMs) / 1000 : 0;
		splits.push({
			kmIndex: k,
			isPartial: false,
			distanceKm: 1,
			durationSec: dur,
			paceSecondsPerKm: dur,
			avgHr: avgHrBetween(prevIdx, index),
			elevationGainM: elevationGainBetween(prevIdx, index)
		});
		prevTimeMs = timeMs;
		prevIdx = index;
	}

	const remainderM = totalMeters - numFullKm * 1000;
	if (remainderM >= 100) {
		const lastTime = times[times.length - 1];
		const dur =
			prevTimeMs != null && lastTime != null ? (lastTime - prevTimeMs) / 1000 : 0;
		const distKm = remainderM / 1000;
		splits.push({
			kmIndex: numFullKm + 1,
			isPartial: true,
			distanceKm: distKm,
			durationSec: dur,
			paceSecondsPerKm: distKm > 0 ? dur / distKm : 0,
			avgHr: avgHrBetween(prevIdx, points.length - 1),
			elevationGainM: elevationGainBetween(prevIdx, points.length - 1)
		});
	}

	return splits;
}

/**
 * Sekunder i hvert bånd. Båndene er PÅKREVD — det finnes ingen default lenger,
 * og det er poenget: en default her var en sonemodell ingen visste at de brukte.
 */
export function computeHrDistribution(
	points: TrackPoint[],
	bands: Omit<HrBand, 'seconds'>[]
): HrBand[] {
	const result: HrBand[] = bands.map((b) => ({ ...b, seconds: 0 }));
	if (points.length < 2) return result;

	for (let i = 1; i < points.length; i++) {
		const t0 = parseTime(points[i - 1]);
		const t1 = parseTime(points[i]);
		const hr = points[i].hr;
		if (t0 == null || t1 == null || typeof hr !== 'number') continue;
		const dt = (t1 - t0) / 1000;
		if (dt <= 0) continue;
		for (const band of result) {
			if (hr >= band.minBpm && hr < band.maxBpm) {
				band.seconds += dt;
				break;
			}
		}
	}
	return result;
}

export function hasHeartRate(points: TrackPoint[]): boolean {
	return points.some((p) => typeof p.hr === 'number');
}

export function hasElevation(points: TrackPoint[]): boolean {
	return points.some((p) => typeof p.ele === 'number');
}
