/**
 * geocode.ts — stedsnavn → koordinater via Nominatim (OpenStreetMap).
 *
 * Brukes klientsiden for å hente vær for et «Sted:»-punkt i dagslista.
 * Resultatet caches i localStorage (stedskoordinater endrer seg ikke), så vi
 * unngår å treffe Nominatim på nytt hver gang arket åpnes. Samme tjeneste som
 * trip-/ferie-dashboardene allerede bruker.
 */

export interface GeoResult {
	lat: number;
	lon: number;
}

const CACHE_PREFIX = 'geo_';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dager

function readCache(key: string): GeoResult | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(CACHE_PREFIX + key);
		if (!raw) return null;
		const entry = JSON.parse(raw) as { lat: number; lon: number; ts: number };
		if (Date.now() - entry.ts > MAX_AGE_MS) return null;
		return { lat: entry.lat, lon: entry.lon };
	} catch {
		return null;
	}
}

function writeCache(key: string, result: GeoResult): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ...result, ts: Date.now() }));
	} catch {
		/* ignore quota/serialisering */
	}
}

/** Geokod et stedsnavn. Returnerer null ved tomt navn, treff uten resultat, eller nettverksfeil. */
export async function geocodePlace(name: string): Promise<GeoResult | null> {
	const key = name.trim().toLowerCase();
	if (!key) return null;

	const cached = readCache(key);
	if (cached) return cached;

	try {
		const res = await fetch(
			`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=json&limit=1&accept-language=nb,en`,
			{ headers: { Accept: 'application/json' } }
		);
		if (!res.ok) return null;
		const data = (await res.json()) as Array<{ lat: string; lon: string }>;
		if (!data.length) return null;
		const result: GeoResult = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
		if (Number.isNaN(result.lat) || Number.isNaN(result.lon)) return null;
		writeCache(key, result);
		return result;
	} catch {
		return null;
	}
}
