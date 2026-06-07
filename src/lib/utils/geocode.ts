/**
 * geocode.ts — stedsnavn → koordinater via Nominatim (OpenStreetMap).
 *
 * Brukes klientsiden når et «Sted:»- eller reise-punkt opprettes. Vi henter
 * flere kandidater, bias-er mot brukerens nærområde (viewbox), og avgjør om
 * treffet er entydig nok til å brukes stille eller om vi må be brukeren velge.
 * Valgt koordinat pinnes på punktet, så vi slipper å geokode på nytt senere.
 *
 * Resultatet caches i localStorage (stedskoordinater endrer seg ikke).
 */

export interface GeoCandidate {
	lat: number;
	lon: number;
	/** Kort, lesbart navn, f.eks. "Håøya, Frogn, Akershus". */
	label: string;
	/** Nominatim «importance» (0–1), brukes til å vurdere dominans. */
	importance: number;
	/** Avstand i km fra `near` hvis oppgitt, ellers null. */
	distanceKm: number | null;
}

export type GeoResolution =
	| { status: 'none' }
	| { status: 'confident'; candidate: GeoCandidate }
	| { status: 'ambiguous'; candidates: GeoCandidate[] };

const CACHE_PREFIX = 'geo_v2_';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dager

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
	const R = 6371;
	const dLat = ((b.lat - a.lat) * Math.PI) / 180;
	const dLon = ((b.lon - a.lon) * Math.PI) / 180;
	const lat1 = (a.lat * Math.PI) / 180;
	const lat2 = (b.lat * Math.PI) / 180;
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Bygg et kort label fra Nominatim-adressedetaljer (sted + kommune/fylke + land). */
function buildLabel(item: NominatimItem): string {
	const a = item.address ?? {};
	const primary =
		a.village ?? a.town ?? a.city ?? a.hamlet ?? a.island ?? a.suburb ?? a.municipality ?? null;
	const region = a.municipality ?? a.county ?? a.state ?? null;
	const parts = [primary, region && region !== primary ? region : null].filter(Boolean) as string[];
	if (parts.length === 0) {
		// Fallback: første ledd av display_name
		return item.display_name.split(',').slice(0, 2).join(',').trim();
	}
	if (a.country && a.country_code && a.country_code !== 'no') parts.push(a.country);
	return parts.join(', ');
}

interface NominatimAddress {
	village?: string;
	town?: string;
	city?: string;
	hamlet?: string;
	island?: string;
	suburb?: string;
	municipality?: string;
	county?: string;
	state?: string;
	country?: string;
	country_code?: string;
}
interface NominatimItem {
	lat: string;
	lon: string;
	importance?: number;
	display_name: string;
	address?: NominatimAddress;
}

function readCache(key: string): GeoCandidate[] | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(CACHE_PREFIX + key);
		if (!raw) return null;
		const entry = JSON.parse(raw) as { candidates: GeoCandidate[]; ts: number };
		if (Date.now() - entry.ts > MAX_AGE_MS) return null;
		return entry.candidates;
	} catch {
		return null;
	}
}

function writeCache(key: string, candidates: GeoCandidate[]): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ candidates, ts: Date.now() }));
	} catch {
		/* ignore */
	}
}

/**
 * Hent geokodings-kandidater for et stedsnavn, biaset mot `near` (brukerens
 * posisjon) når oppgitt. Returnerer opptil 5 kandidater rangert av Nominatim.
 */
export async function geocodeCandidates(
	name: string,
	near?: { lat: number; lon: number } | null
): Promise<GeoCandidate[]> {
	const key = `${name.trim().toLowerCase()}|${near ? `${near.lat.toFixed(1)},${near.lon.toFixed(1)}` : ''}`;
	if (!name.trim()) return [];

	const cached = readCache(key);
	if (cached) return cached;

	const params = new URLSearchParams({
		q: name,
		format: 'jsonv2',
		limit: '5',
		addressdetails: '1',
		'accept-language': 'nb,en'
	});
	// Myk nærhets-bias: foretrekk treff i en boks rundt brukeren, men ekskluder
	// ikke fjerne treff (bounded=0) — så «Dublin» fortsatt funker.
	if (near) {
		const d = 2.5; // ~250 km boks
		params.set('viewbox', `${near.lon - d},${near.lat + d},${near.lon + d},${near.lat - d}`);
		params.set('bounded', '0');
	}

	try {
		const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
			headers: { Accept: 'application/json' }
		});
		if (!res.ok) return [];
		const data = (await res.json()) as NominatimItem[];
		const candidates: GeoCandidate[] = [];
		const seen = new Set<string>();
		for (const item of data) {
			const lat = parseFloat(item.lat);
			const lon = parseFloat(item.lon);
			if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
			const label = buildLabel(item);
			const dedupeKey = label.toLowerCase();
			if (seen.has(dedupeKey)) continue;
			seen.add(dedupeKey);
			candidates.push({
				lat,
				lon,
				label,
				importance: item.importance ?? 0,
				distanceKm: near ? Math.round(haversineKm(near, { lat, lon })) : null
			});
		}
		writeCache(key, candidates);
		return candidates;
	} catch {
		return [];
	}
}

const NEARBY_KM = 150;

/**
 * Geokod og avgjør om treffet er entydig nok til å brukes stille.
 *
 * - Ingen treff → 'none'.
 * - Ett treff → 'confident'.
 * - Med kjent posisjon: nøyaktig ett treff innen 150 km → 'confident' (det nære);
 *   ingen nære treff → 'confident' på beste treff (f.eks. «Dublin»);
 *   flere nære treff → 'ambiguous'.
 * - Uten kjent posisjon: flere treff → 'ambiguous'.
 */
export async function resolvePlace(
	name: string,
	near?: { lat: number; lon: number } | null
): Promise<GeoResolution> {
	const candidates = await geocodeCandidates(name, near);
	if (candidates.length === 0) return { status: 'none' };
	if (candidates.length === 1) return { status: 'confident', candidate: candidates[0] };

	if (near) {
		const nearby = candidates.filter((c) => (c.distanceKm ?? Infinity) <= NEARBY_KM);
		if (nearby.length === 1) return { status: 'confident', candidate: nearby[0] };
		if (nearby.length === 0) {
			// Ingen nære — men hvis ett treff dominerer klart på importance, bruk det.
			const [top, second] = candidates;
			if (top.importance - second.importance > 0.15) {
				return { status: 'confident', candidate: top };
			}
			return { status: 'ambiguous', candidates };
		}
		return { status: 'ambiguous', candidates };
	}

	return { status: 'ambiguous', candidates };
}

/** Bakoverkompatibelt: beste treff (biaset), eller null. Brukt der vi ikke spør. */
export async function geocodePlace(
	name: string,
	near?: { lat: number; lon: number } | null
): Promise<{ lat: number; lon: number } | null> {
	const resolution = await resolvePlace(name, near);
	if (resolution.status === 'confident') {
		return { lat: resolution.candidate.lat, lon: resolution.candidate.lon };
	}
	if (resolution.status === 'ambiguous') {
		// Uten brukervalg: ta nærmeste hvis posisjon kjent, ellers første.
		const sorted = [...resolution.candidates].sort(
			(a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)
		);
		return { lat: sorted[0].lat, lon: sorted[0].lon };
	}
	return null;
}
