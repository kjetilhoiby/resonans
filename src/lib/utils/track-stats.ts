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

export const DEFAULT_HR_BANDS: Omit<HrBand, 'seconds'>[] = [
	{ label: 'Rolig', minBpm: 0, maxBpm: 120, color: '#60a5fa' },
	{ label: 'Lett', minBpm: 120, maxBpm: 140, color: '#34d399' },
	{ label: 'Moderat', minBpm: 140, maxBpm: 160, color: '#fbbf24' },
	{ label: 'Hard', minBpm: 160, maxBpm: 180, color: '#fb923c' },
	{ label: 'Maks', minBpm: 180, maxBpm: 999, color: '#ef4444' }
];

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

export function computeHrDistribution(
	points: TrackPoint[],
	bands: Omit<HrBand, 'seconds'>[] = DEFAULT_HR_BANDS
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
