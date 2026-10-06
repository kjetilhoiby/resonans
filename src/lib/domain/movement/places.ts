/**
 * Stedslista fra en app (i dag Akser): validering før lagring i `app_places`.
 *
 * Kontrakten står i `docs/akser-tidslinje.md`. Lista sendes HEL hver gang; et sted
 * som mangler arkiveres hos oss, det slettes ikke, siden gamle dager peker på det.
 * Det avgjøres av endepunktet — her valideres bare lista.
 *
 * Hver app eier sine egne steder. Resonans kobler dem senere, men skriver aldri
 * tilbake til appene (se changelogen, «Beslutninger»).
 */

export const PLACE_CATEGORIES = [
	'home',
	'work',
	'gym',
	'shop',
	'restaurant',
	'transport',
	'recreation',
	'friend',
	'family',
	'unknown'
] as const;
export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

export const MAX_PLACES = 2000;
export const MIN_RADIUS_METERS = 5;
export const MAX_RADIUS_METERS = 10_000;
export const MAX_NAME_LENGTH = 200;

export interface NormalizedPlace {
	externalId: string;
	name: string;
	category: PlaceCategory;
	latitude: number;
	longitude: number;
	radiusMeters: number;
	/** `false` er Aksers automatiske «Nytt sted». Lagres, men vises ikke med navn. */
	named: boolean;
	archived: boolean;
}

export type PlacesResult = { ok: true; places: NormalizedPlace[] } | { ok: false; message: string };

/** Hele lista avvises ved første feil: et halvt lagret stedsregister er verre enn intet. */
export function normalizePlaces(body: unknown): PlacesResult {
	if (!isRecord(body) || !Array.isArray(body.places)) {
		return { ok: false, message: 'Forventet { places: [...] }' };
	}
	if (body.places.length > MAX_PLACES) {
		return { ok: false, message: `Høyst ${MAX_PLACES} steder` };
	}

	const seen = new Set<string>();
	const places: NormalizedPlace[] = [];
	for (let i = 0; i < body.places.length; i++) {
		const raw = body.places[i];
		const path = `places[${i}]`;
		if (!isRecord(raw)) return { ok: false, message: `${path} er ikke et objekt` };

		const id = raw.id;
		if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
			return { ok: false, message: `${path}.id må være tekst` };
		}
		if (seen.has(id)) return { ok: false, message: `${path}.id forekommer to ganger` };
		seen.add(id);

		const name = typeof raw.name === 'string' ? raw.name.trim() : '';
		if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
			return { ok: false, message: `${path}.name må være tekst på 1–${MAX_NAME_LENGTH} tegn` };
		}

		if (typeof raw.category !== 'string' || !(PLACE_CATEGORIES as readonly string[]).includes(raw.category)) {
			return { ok: false, message: `${path}.category er ukjent: ${String(raw.category)}` };
		}

		const { lat, lon } = raw;
		if (typeof lat !== 'number' || !(lat >= -90 && lat <= 90)) {
			return { ok: false, message: `${path}.lat må være mellom -90 og 90` };
		}
		if (typeof lon !== 'number' || !(lon >= -180 && lon <= 180)) {
			return { ok: false, message: `${path}.lon må være mellom -180 og 180` };
		}

		const radius = raw.radiusMeters;
		if (typeof radius !== 'number' || !(radius >= MIN_RADIUS_METERS && radius <= MAX_RADIUS_METERS)) {
			return {
				ok: false,
				message: `${path}.radiusMeters må være mellom ${MIN_RADIUS_METERS} og ${MAX_RADIUS_METERS}`
			};
		}

		if (typeof raw.named !== 'boolean' || typeof raw.archived !== 'boolean') {
			return { ok: false, message: `${path}.named og archived må være true eller false` };
		}

		places.push({
			externalId: id,
			name,
			category: raw.category as PlaceCategory,
			latitude: lat,
			longitude: lon,
			radiusMeters: Math.round(radius),
			named: raw.named,
			archived: raw.archived
		});
	}
	return { ok: true, places };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
