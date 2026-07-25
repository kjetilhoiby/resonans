/**
 * Ren logikk for TrackReplay — 3D-avspilling av en tur delt på web. Bygger den tegnbare
 * ruten fra trackpunkter og plasserer bilder «på rett tidspunkt (og dermed sted)» ved å
 * matche hvert bildes opptakstidspunkt mot nærmeste trackpunkt-tid → posisjon langs ruta.
 *
 * Holdt utenfor .svelte-komponenten så den kan enhetstestes uten DOM/MapLibre
 * (samme mønster som `trip-map-story.ts`).
 */

export interface ReplayTrackPoint {
	lat: number;
	lon: number;
	ele?: number | null;
	time?: string | null; // ISO
}

export interface ReplayPhotoInput {
	url: string;
	takenAt?: string | null; // ISO — opptakstidspunkt
	caption?: string | null;
}

export interface ReplayPhotoPin {
	url: string;
	caption?: string | null;
	lat: number;
	lon: number;
	/** Hvor langs ruta bildet ligger (0–1 av total lengde) — brukes til å poppe det i avspillingen. */
	fraction: number;
	timeMs: number | null;
}

export interface Replay {
	coords: [number, number][]; // [lon, lat] for MapLibre
	cumulative: number[]; // kumulativ distanse (m) per punkt
	totalMeters: number;
	photos: ReplayPhotoPin[]; // sortert etter fraction
}

function toRad(deg: number): number {
	return (deg * Math.PI) / 180;
}

export function haversineMeters(
	a: { lat: number; lon: number },
	b: { lat: number; lon: number }
): number {
	const R = 6371000;
	const dLat = toRad(b.lat - a.lat);
	const dLon = toRad(b.lon - a.lon);
	const lat1 = toRad(a.lat);
	const lat2 = toRad(b.lat);
	const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** Indeks til trackpunktet hvis tid er nærmest `tMs`, blant punkter med kjent tid. */
function nearestIndexByTime(times: number[], tMs: number): number {
	let best = 0;
	let bestDiff = Infinity;
	for (let i = 0; i < times.length; i++) {
		if (!Number.isFinite(times[i])) continue;
		const diff = Math.abs(times[i] - tMs);
		if (diff < bestDiff) {
			bestDiff = diff;
			best = i;
		}
	}
	return best;
}

/**
 * Bygger avspillingsdata: rutegeometri, kumulativ distanse, og bildene plassert langs ruta.
 * Bilder matches på tid når både trackpunkter og bilder har tidsstempler; ellers fordeles de
 * jevnt etter rekkefølge (fallback for spor uten tid).
 */
export function buildReplay(points: ReplayTrackPoint[], photos: ReplayPhotoInput[] = []): Replay {
	const coords = points.map((p) => [p.lon, p.lat] as [number, number]);

	const cumulative: number[] = [0];
	for (let i = 1; i < points.length; i++) {
		cumulative.push(cumulative[i - 1] + haversineMeters(points[i - 1], points[i]));
	}
	const totalMeters = cumulative.length ? cumulative[cumulative.length - 1] : 0;

	const times = points.map((p) => (p.time ? Date.parse(p.time) : NaN));
	const hasPointTimes = times.some((t) => Number.isFinite(t));

	const pins: ReplayPhotoPin[] = photos
		.map((photo, i) => {
			const tMs = photo.takenAt ? Date.parse(photo.takenAt) : NaN;
			let idx: number;
			if (hasPointTimes && Number.isFinite(tMs)) {
				idx = nearestIndexByTime(times, tMs);
			} else if (points.length > 0) {
				// Jevn fordeling etter rekkefølge når tid mangler.
				const frac = photos.length <= 1 ? 0 : i / (photos.length - 1);
				idx = Math.round(frac * (points.length - 1));
			} else {
				idx = 0;
			}
			const point = points[idx];
			return {
				url: photo.url,
				caption: photo.caption ?? null,
				lat: point?.lat ?? 0,
				lon: point?.lon ?? 0,
				fraction: totalMeters > 0 ? cumulative[idx] / totalMeters : 0,
				timeMs: Number.isFinite(tMs) ? tMs : null
			};
		})
		.sort((a, b) => a.fraction - b.fraction);

	return { coords, cumulative, totalMeters, photos: pins };
}
