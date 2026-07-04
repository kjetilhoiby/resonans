/**
 * tesla-routes.ts
 *
 * Ren logikk for å bygge kjørespor per dag fra Teslas drive_state-sensor-events.
 * Brukes av import-endepunktet for kartfortellingen: posisjons-breadcrumbs fra
 * sync-pollingen (hvert 15. min i ro, hvert 45. sek under kjøring via Ekko)
 * filtreres for stillstands-støy, grupperes per Oslo-dag og tynnes til et
 * håndterlig antall punkter. Ingen DB/IO — kallere mater inn punkter og
 * persisterer resultatet i themes.tripProfile.driveRoutes.
 */

import { osloDayKey } from './trip-geo';

export interface DrivePoint {
	lat: number;
	lon: number;
	timestamp: Date;
}

/** Kjørespor per ISO-dato som [lon, lat]-par (GeoJSON-rekkefølge, som rutelinja). */
export type DriveRoutes = Record<string, Array<[number, number]>>;

/** Minste bevegelse mellom to beholdte punkter — filtrerer GPS-jitter ved parkering. */
const MIN_MOVE_M = 50;
/** En dag må ha kjørt minst så langt for å regnes som kjøredag. */
const MIN_DAY_DISTANCE_M = 1000;
/** Tak per dag så tripProfile-jsonb ikke vokser ubegrenset. */
const MAX_POINTS_PER_DAY = 300;

/** Omtrentlig avstand i meter (ekvirektangulær — god nok for filtrering). */
export function approxDistanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
	const R = 6371000;
	const rad = Math.PI / 180;
	const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
	const y = (b.lat - a.lat) * rad;
	return Math.sqrt(x * x + y * y) * R;
}

/** Uniform tynning til maks `max` punkter. Første og siste beholdes alltid. */
export function decimate<T>(points: T[], max: number): T[] {
	if (points.length <= max || max < 2) return points.slice(0, Math.max(0, max === 1 ? 1 : points.length));
	const out: T[] = [];
	const step = (points.length - 1) / (max - 1);
	for (let i = 0; i < max; i++) {
		out.push(points[Math.round(i * step)]);
	}
	return out;
}

/**
 * Bygg kjørespor per dag fra rå posisjonspunkter. Punkter sorteres kronologisk,
 * grupperes per Oslo-dag, og innen dagen droppes punkter som er nærmere forrige
 * beholdte punkt enn MIN_MOVE_M (parkerings-jitter). Dager med under
 * MIN_DAY_DISTANCE_M total bevegelse utelates. Resultatet tynnes til maks
 * MAX_POINTS_PER_DAY punkter per dag.
 */
export function buildDriveRoutes(points: DrivePoint[], timezone = 'Europe/Oslo'): DriveRoutes {
	const sorted = points
		.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
		.slice()
		.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

	const byDay = new Map<string, DrivePoint[]>();
	for (const p of sorted) {
		const key = osloDayKey(p.timestamp, timezone);
		const arr = byDay.get(key);
		if (arr) arr.push(p);
		else byDay.set(key, [p]);
	}

	const routes: DriveRoutes = {};
	for (const [day, dayPoints] of byDay) {
		const kept: DrivePoint[] = [];
		let total = 0;
		for (const p of dayPoints) {
			const prev = kept[kept.length - 1];
			if (!prev) {
				kept.push(p);
				continue;
			}
			const d = approxDistanceM(prev, p);
			if (d < MIN_MOVE_M) continue;
			kept.push(p);
			total += d;
		}
		if (kept.length < 2 || total < MIN_DAY_DISTANCE_M) continue;
		routes[day] = decimate(kept, MAX_POINTS_PER_DAY).map((p) => [p.lon, p.lat]);
	}
	return routes;
}
