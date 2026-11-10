import type { ParsedWorkout } from '$lib/server/integrations/dropbox-sync';

/**
 * Treningsdata fra en GPX/TCX-fil i en e-post: tynner ut sporet og bygger
 * `data`/`metadata` til sensor-hendelsen. Brukt av `email-processors/workout.ts`.
 */

type RawPoint = { lat: number; lon: number; ele?: number | null; hr?: number | null; time?: string | null };

export function decimateTrack(pts: RawPoint[], maxPoints: number): RawPoint[] {
	if (pts.length <= maxPoints) return pts;

	function dist(a: RawPoint, b: RawPoint): number {
		const R = 6371000;
		const dLat = ((b.lat - a.lat) * Math.PI) / 180;
		const dLon = ((b.lon - a.lon) * Math.PI) / 180;
		const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
		return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
	}

	function bearing(a: RawPoint, b: RawPoint): number {
		const dLon = ((b.lon - a.lon) * Math.PI) / 180;
		const lat1 = (a.lat * Math.PI) / 180;
		const lat2 = (b.lat * Math.PI) / 180;
		return Math.atan2(Math.sin(dLon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon));
	}

	const scores = new Float64Array(pts.length);
	scores[0] = Infinity;
	scores[pts.length - 1] = Infinity;

	const speeds: number[] = [];
	for (let i = 1; i < pts.length; i++) {
		const d = dist(pts[i - 1], pts[i]);
		const tA = pts[i - 1].time ? new Date(pts[i - 1].time!).getTime() : 0;
		const tB = pts[i].time ? new Date(pts[i].time!).getTime() : 0;
		const dt = tA && tB ? (tB - tA) / 1000 : 0;
		speeds.push(dt > 0 ? d / dt : 0);
	}
	const maxSpeed = Math.max(...speeds, 1);
	const hrValues = pts.map((p) => p.hr ?? null).filter((v): v is number => v !== null);
	const hrRange = hrValues.length ? Math.max(...hrValues) - Math.min(...hrValues) : 1;

	for (let i = 1; i < pts.length - 1; i++) {
		const b1 = bearing(pts[i - 1], pts[i]);
		const b2 = bearing(pts[i], pts[i + 1]);
		let dirDelta = Math.abs(b2 - b1);
		if (dirDelta > Math.PI) dirDelta = 2 * Math.PI - dirDelta;
		const dirScore = dirDelta / Math.PI;

		const speedDelta = Math.abs(speeds[i] - speeds[i - 1]) / maxSpeed;

		const hrA = pts[i - 1].hr;
		const hrB = pts[i].hr;
		const hrScore = hrA != null && hrB != null ? Math.abs(hrB - hrA) / (hrRange || 1) : 0;

		scores[i] = dirScore * 0.5 + speedDelta * 0.3 + hrScore * 0.2;
	}

	const indices = Array.from({ length: pts.length }, (_, i) => i);
	indices.sort((a, b) => scores[b] - scores[a]);
	const kept = new Set(indices.slice(0, maxPoints));

	return pts.filter((_, i) => kept.has(i));
}

export function buildWorkoutData(parsed: ParsedWorkout) {
	const paceSecondsPerKm = parsed.distance > 0
		? parsed.duration / (parsed.distance / 1000)
		: undefined;

	const MAX_POINTS = 1800;
	const raw = parsed.trackPoints;
	const sampledTrack = decimateTrack(raw, MAX_POINTS).map((p) => ({
		lat: p.lat,
		lon: p.lon,
		ele: p.ele,
		hr: p.hr,
		time: p.time
	}));

	return {
		data: {
			sportType: parsed.sportType,
			duration: parsed.duration,
			distance: parsed.distance,
			elevation: parsed.elevation,
			avgHeartRate: parsed.avgHeartRate,
			maxHeartRate: parsed.maxHeartRate,
			minHeartRate: parsed.minHeartRate,
			paceSecondsPerKm,
			trackPoints: sampledTrack
		},
		metadata: {
			source: 'email',
			sourceFormat: parsed.sourceFormat,
			totalTrackPoints: parsed.trackPoints.length
		}
	};
}
