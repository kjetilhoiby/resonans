/**
 * Ren logikk for 3D-avspilling av en gåtur (Ekko-tur) — plassering av vedlagte
 * bilder langs sporet, avledede nøkkeltall, og kart-utstrekning. Holdt utenfor
 * .svelte-komponenten så den kan enhetstestes uten DOM/MapLibre.
 *
 * Gjenbruker `cumulativeFractions` fra kartfortellingen så et bilde kan feste
 * seg til «hvor langt ute på turen» det ble tatt (0–1 av rutelengden) — samme
 * andels-modell som fullskjerm-fortellingen bruker til å la ruten vokse.
 */

import { cumulativeFractions } from './trip-map-story';

/** Ett GPS-punkt i et opplastet gåtur-spor (samme form som /api/activities/[id]/track). */
export interface WalkTrackPoint {
	lat: number;
	lon: number;
	ele?: number | null;
	hr?: number | null;
	time?: string | null;
}

/**
 * Et bilde vedlagt turen. `capturedAt`/`lat`/`lon` er valgfrie — de brukes til å
 * feste bildet til riktig sted på ruten. Uten dem fordeles bilder jevnt.
 */
export interface WalkImage {
	url: string;
	caption?: string | null;
	capturedAt?: string | null;
	lat?: number | null;
	lon?: number | null;
}

/** Et bilde plassert på ruten: koordinat + andel (0–1) av rutelengden. */
export interface WalkImagePin {
	url: string;
	caption?: string;
	lat: number;
	lon: number;
	fraction: number;
}

export interface WalkStats {
	distanceMeters: number;
	durationSeconds: number | null;
	ascentMeters: number;
	pointCount: number;
}

/** Ett punkt i høydeprofilen: andel (0–1) av rutelengden + høyde i meter. */
export interface WalkElevationSample {
	/** Samme andels-modell som avspillingens `progress` (kumulativ rutelengde). */
	x: number;
	ele: number;
}

/** Høydeprofil for turen — til det valgfrie høydekurve-overlayet. */
export interface WalkElevationProfile {
	/** Minst to punkter med høyde → kurven kan tegnes. */
	hasData: boolean;
	minEle: number;
	maxEle: number;
	samples: WalkElevationSample[];
}

export interface WalkPlayback {
	/** Tett koordinatliste for rutelinja, [lon, lat] (MapLibre-rekkefølge). */
	coords: Array<[number, number]>;
	imagePins: WalkImagePin[];
	stats: WalkStats;
	/** Midtpunkt av utstrekningen, [lon, lat]. Startpunkt for kamera. */
	center: [number, number];
	/** [[minLon, minLat], [maxLon, maxLat]] — for fitBounds. */
	bounds: [[number, number], [number, number]];
	/** Høydeprofil langs ruta (til høydekurve-overlayet). */
	elevation: WalkElevationProfile;
}

/** Filtrer sporet til gyldige punkter og gjør om til [lon, lat]-rekkefølge. */
export function trackToCoords(track: WalkTrackPoint[]): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	for (const p of track) {
		if (typeof p?.lat === 'number' && typeof p?.lon === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
			out.push([p.lon, p.lat]);
		}
	}
	return out;
}

/** Haversine-avstand i meter mellom to [lon, lat]-punkter. */
export function haversineMeters(a: [number, number], b: [number, number]): number {
	const R = 6_371_000;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(b[1] - a[1]);
	const dLon = toRad(b[0] - a[0]);
	const lat1 = toRad(a[1]);
	const lat2 = toRad(b[1]);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Avledede nøkkeltall fra et spor (fallback når event-data mangler). */
export function walkStatsFromTrack(track: WalkTrackPoint[]): WalkStats {
	const valid = track.filter((p) => typeof p?.lat === 'number' && typeof p?.lon === 'number');
	let distance = 0;
	let ascent = 0;
	for (let i = 1; i < valid.length; i++) {
		distance += haversineMeters([valid[i - 1].lon, valid[i - 1].lat], [valid[i].lon, valid[i].lat]);
		const prevEle = valid[i - 1].ele;
		const ele = valid[i].ele;
		if (typeof prevEle === 'number' && typeof ele === 'number' && ele > prevEle) {
			ascent += ele - prevEle;
		}
	}
	const times = valid.map((p) => (p.time ? Date.parse(p.time) : NaN)).filter((t) => Number.isFinite(t));
	const durationSeconds =
		times.length >= 2 ? Math.max(0, Math.round((Math.max(...times) - Math.min(...times)) / 1000)) : null;
	return {
		distanceMeters: Math.round(distance),
		durationSeconds,
		ascentMeters: Math.round(ascent),
		pointCount: valid.length
	};
}

function nearestIndexByTime(track: WalkTrackPoint[], capturedMs: number): number | null {
	let best = -1;
	let bestDiff = Infinity;
	for (let i = 0; i < track.length; i++) {
		const t = track[i].time ? Date.parse(track[i].time as string) : NaN;
		if (!Number.isFinite(t)) continue;
		const diff = Math.abs(t - capturedMs);
		if (diff < bestDiff) {
			bestDiff = diff;
			best = i;
		}
	}
	return best >= 0 ? best : null;
}

function nearestIndexByGeo(coords: Array<[number, number]>, point: [number, number]): number | null {
	let best = -1;
	let bestDist = Infinity;
	for (let i = 0; i < coords.length; i++) {
		const d = haversineMeters(coords[i], point);
		if (d < bestDist) {
			bestDist = d;
			best = i;
		}
	}
	return best >= 0 ? best : null;
}

/**
 * Fester hvert bilde til et punkt på ruten. Prioritering per bilde:
 *   1. `capturedAt` matchet mot nærmeste spor-punkt i tid
 *   2. `lat`/`lon` matchet mot nærmeste spor-punkt i avstand
 *   3. jevn fordeling etter rekkefølge (indeks / (antall+1))
 * Bilder uten treff (tomt spor) hoppes over. Sortert etter andel.
 */
export function placeImagesOnTrack(track: WalkTrackPoint[], images: WalkImage[]): WalkImagePin[] {
	const coords = trackToCoords(track);
	if (coords.length === 0) return [];
	const fractions = cumulativeFractions(coords);

	const pins: WalkImagePin[] = [];
	images.forEach((img, order) => {
		if (!img?.url) return;
		let idx: number | null = null;

		if (img.capturedAt) {
			const ms = Date.parse(img.capturedAt);
			if (Number.isFinite(ms)) idx = nearestIndexByTime(track, ms);
		}
		if (idx == null && typeof img.lat === 'number' && typeof img.lon === 'number') {
			idx = nearestIndexByGeo(coords, [img.lon, img.lat]);
		}

		let lon: number;
		let lat: number;
		let fraction: number;
		if (idx != null) {
			[lon, lat] = coords[idx];
			fraction = fractions[idx] ?? 0;
		} else {
			// Jevn fordeling: bilde k av n havner på (k+1)/(n+1) av ruten.
			fraction = (order + 1) / (images.length + 1);
			const at = Math.round(fraction * (coords.length - 1));
			[lon, lat] = coords[Math.max(0, Math.min(coords.length - 1, at))];
		}

		pins.push({
			url: img.url,
			caption: img.caption ?? undefined,
			lat,
			lon,
			fraction
		});
	});

	pins.sort((a, b) => a.fraction - b.fraction);
	return pins;
}

/** Utstrekning ([[minLon,minLat],[maxLon,maxLat]]) og midtpunkt for et sett koordinater. */
export function coordsBounds(
	coords: Array<[number, number]>
): { bounds: [[number, number], [number, number]]; center: [number, number] } {
	if (coords.length === 0) {
		return { bounds: [[0, 0], [0, 0]], center: [0, 0] };
	}
	let minLon = Infinity;
	let minLat = Infinity;
	let maxLon = -Infinity;
	let maxLat = -Infinity;
	for (const [lon, lat] of coords) {
		if (lon < minLon) minLon = lon;
		if (lat < minLat) minLat = lat;
		if (lon > maxLon) maxLon = lon;
		if (lat > maxLat) maxLat = lat;
	}
	return {
		bounds: [
			[minLon, minLat],
			[maxLon, maxLat]
		],
		center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2]
	};
}

/**
 * Bygger høydeprofilen langs ruta. `x` bruker samme kumulative rutelengde-andel
 * (`cumulativeFractions`) som avspillingens `progress`, så en markør på kurven
 * kan følge fly-through-en/scrubbingen direkte. Punkter uten høyde hoppes over;
 * finnes færre enn to, er `hasData` false og overlayet vises ikke.
 */
export function buildElevationProfile(track: WalkTrackPoint[]): WalkElevationProfile {
	const valid = track.filter(
		(p) =>
			typeof p?.lat === 'number' &&
			typeof p?.lon === 'number' &&
			Number.isFinite(p.lat) &&
			Number.isFinite(p.lon)
	);
	const coords = valid.map((p) => [p.lon, p.lat] as [number, number]);
	const fractions = cumulativeFractions(coords);
	const samples: WalkElevationSample[] = [];
	let minEle = Infinity;
	let maxEle = -Infinity;
	valid.forEach((p, i) => {
		const ele = p.ele;
		if (typeof ele === 'number' && Number.isFinite(ele)) {
			samples.push({ x: fractions[i] ?? 0, ele });
			if (ele < minEle) minEle = ele;
			if (ele > maxEle) maxEle = ele;
		}
	});
	const hasData = samples.length >= 2;
	return {
		hasData,
		minEle: hasData ? minEle : 0,
		maxEle: hasData ? maxEle : 0,
		samples: hasData ? samples : []
	};
}

/**
 * Setter sammen alt en 3D-avspilling trenger: rutelinje, plasserte bilder,
 * nøkkeltall og kart-utstrekning. `storedStats` (fra det opplastede
 * workout-eventet) vinner over avledede tall når de finnes.
 */
export function buildWalkPlayback(
	track: WalkTrackPoint[],
	images: WalkImage[],
	storedStats?: Partial<WalkStats>
): WalkPlayback {
	const coords = trackToCoords(track);
	const derived = walkStatsFromTrack(track);
	const { bounds, center } = coordsBounds(coords);
	return {
		coords,
		imagePins: placeImagesOnTrack(track, images),
		stats: {
			distanceMeters: storedStats?.distanceMeters ?? derived.distanceMeters,
			durationSeconds: storedStats?.durationSeconds ?? derived.durationSeconds,
			ascentMeters: storedStats?.ascentMeters ?? derived.ascentMeters,
			pointCount: derived.pointCount
		},
		center,
		bounds,
		elevation: buildElevationProfile(track)
	};
}
