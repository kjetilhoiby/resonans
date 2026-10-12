/**
 * «Hvor er jeg nå» fra Akser: validering, ferskhet og valget av værsted. Ren fil —
 * lagringen bor i `$lib/server/movement/presence-store.ts`, endepunktet i
 * `routes/api/apps/akser/now`. Kontrakten står i `docs/akser-tidslinje.md`.
 *
 * ## Frivillig, og grovt
 *
 * Akser sender bare når brukeren har slått på «Del hvor jeg er nå». Signalet er ett
 * sted (Aksers id), eller en posisjon avrundet til ~1 km (`HOME_WEATHER_DECIMALS`),
 * aldri mer. Grensa håndheves her også: en klient som glemmer å avrunde skal ikke
 * kunne legge en presis posisjon i basen.
 *
 * ## Én rad, ingen historikk
 *
 * Det som skjedde kommer med de ferdige dagene (`timeline`). «Nå» er bare nå, og
 * overskrives. Uten historikk kan ikke tabellen bli et spor.
 */

import { MOVEMENT_MODES, type MovementMode } from './timeline';
import { roundForWeather } from './home-place';
import { MODE_LABELS } from './movement-summary';

export const PRESENCE_STATES = ['stay', 'journey'] as const;
export type PresenceState = (typeof PRESENCE_STATES)[number];

/**
 * Hvor lenge et signal gjelder uten nytt. Et opphold er sant til en avreise, og en
 * avreise vekker Akser (geofence, betydelig flytting) – men en telefon som døde
 * sier ingenting, så også et opphold går ut. En reise som ikke er oppdatert på en
 * time er ikke en reise vi vet noe om lenger.
 */
export const PRESENCE_MAX_AGE_MS: Record<PresenceState, number> = {
	stay: 48 * 3600_000,
	journey: 3600_000
};

/** Klokka på telefonen kan gå litt foran serveren */
const FUTURE_SLACK_MS = 5 * 60_000;
const ISO_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export interface NormalizedPresence {
	state: PresenceState;
	/** Når oppholdet eller reisen begynte */
	since: string;
	/** Når Akser bygde signalet. En eldre enn den lagrede skriver ingenting. */
	generatedAt: string;
	/** Aksers sted-id, når brukeren er på et kjent sted */
	placeId: string | null;
	/** Transportform, bare på en reise */
	mode: MovementMode | null;
	/** Avrundet til ~1 km. Brukes til været der ingen kjent plass finnes. */
	approx: { lat: number; lon: number } | null;
}

export type PresenceResult =
	| { ok: true; presence: NormalizedPresence; warnings: string[] }
	| { ok: false; message: string };

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
	return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function instant(value: unknown): number | null {
	if (typeof value !== 'string' || !ISO_WITH_OFFSET_RE.test(value)) return null;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? null : ms;
}

/**
 * Kroppen felt for felt, aldri med en spread. Et ukjent sted gjettes ikke: id-en
 * droppes med en advarsel, og posisjonen står igjen (stedslista kan ligge en runde
 * etter et nytt sted).
 */
export function normalizePresence(
	body: unknown,
	knownPlaceIds: ReadonlySet<string>,
	now: Date = new Date()
): PresenceResult {
	if (!isObject(body)) return { ok: false, message: 'Kroppen må være et objekt' };

	if (!isOneOf(PRESENCE_STATES, body.state)) {
		return { ok: false, message: `state må være en av ${PRESENCE_STATES.join(', ')}` };
	}
	const state = body.state;

	const generatedMs = instant(body.generatedAt);
	if (generatedMs === null) return { ok: false, message: 'generatedAt må være et ISO-tidspunkt med tidssone' };
	if (generatedMs > now.getTime() + FUTURE_SLACK_MS) return { ok: false, message: 'generatedAt ligger fram i tid' };

	const sinceMs = instant(body.since);
	if (sinceMs === null) return { ok: false, message: 'since må være et ISO-tidspunkt med tidssone' };
	if (sinceMs > generatedMs + FUTURE_SLACK_MS) return { ok: false, message: 'since ligger etter generatedAt' };

	let mode: MovementMode | null = null;
	if (state === 'journey') {
		if (!isOneOf(MOVEMENT_MODES, body.mode)) {
			return { ok: false, message: `mode må være en av ${MOVEMENT_MODES.join(', ')} på en reise` };
		}
		mode = body.mode;
	} else if (body.mode !== undefined && body.mode !== null) {
		return { ok: false, message: 'mode hører bare til en reise' };
	}

	const warnings: string[] = [];
	let placeId: string | null = null;
	if (body.placeId !== undefined && body.placeId !== null) {
		if (typeof body.placeId !== 'string' || body.placeId.length === 0 || body.placeId.length > 100) {
			return { ok: false, message: 'placeId må være en tekst' };
		}
		if (state === 'journey') return { ok: false, message: 'placeId hører bare til et opphold' };
		if (knownPlaceIds.has(body.placeId)) {
			placeId = body.placeId;
		} else {
			warnings.push('placeId er ukjent (sendes stedene først?) – lagret uten sted');
		}
	}

	let approx: NormalizedPresence['approx'] = null;
	if (body.approx !== undefined && body.approx !== null) {
		if (!isObject(body.approx)) return { ok: false, message: 'approx må være { lat, lon }' };
		const { lat, lon } = body.approx;
		if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)
			|| lat < -90 || lat > 90 || lon < -180 || lon > 180) {
			return { ok: false, message: 'approx må ha lat og lon i gyldig område' };
		}
		approx = { lat: roundForWeather(lat), lon: roundForWeather(lon) };
	}

	if (placeId === null && approx === null) {
		return { ok: false, message: 'Signalet må ha et kjent sted eller en avrundet posisjon' };
	}

	return {
		ok: true,
		warnings,
		presence: {
			state,
			since: new Date(sinceMs).toISOString(),
			generatedAt: new Date(generatedMs).toISOString(),
			placeId,
			mode,
			approx
		}
	};
}

/** Er signalet fortsatt noe vi vet? Målt fra når Akser bygde det. */
export function isPresenceFresh(p: { state: PresenceState; generatedAt: string }, now: Date = new Date()): boolean {
	const age = now.getTime() - Date.parse(p.generatedAt);
	return age >= -FUTURE_SLACK_MS && age <= PRESENCE_MAX_AGE_MS[p.state];
}

export interface WeatherCandidate {
	name: string;
	latitude: number;
	longitude: number;
}

export type WeatherSource = 'now' | 'home';

/**
 * Hvor været for en dag hentes, når planen ikke sier noe. «Nå» gjelder bare i dag:
 * at du er på jobb nå sier ingenting om været hjemme på torsdag. Ellers hjemmet.
 * Null når ingen av dem finnes – da bestemmer kalleren sin egen reserve.
 */
export function pickWeatherLocation(args: {
	day: string;
	today: string;
	now: WeatherCandidate | null;
	home: WeatherCandidate | null;
}): (WeatherCandidate & { source: WeatherSource }) | null {
	if (args.day === args.today && args.now) return { ...args.now, source: 'now' };
	if (args.home) return { ...args.home, source: 'home' };
	return null;
}

/** Det som går ut av huset om «nå»: tilstand, siden, transportform og stedet – aldri koordinater */
export interface PresenceNow {
	state: PresenceState;
	since: string;
	mode: MovementMode | null;
	place: { name: string | null; category: string } | null;
}

/**
 * «Nå: på Jobb siden 08:24.» til chatten. Et sted uten navn sies som et sted, ikke som en
 * gjetning på hva det er.
 */
export function describePresenceNow(p: PresenceNow, timeZone = 'Europe/Oslo'): string {
	const time = new Intl.DateTimeFormat('nb-NO', { timeZone, hour: '2-digit', minute: '2-digit' }).format(
		new Date(p.since)
	);
	if (p.state === 'journey') {
		const mode = p.mode && p.mode !== 'unknown' ? ` (${MODE_LABELS[p.mode]})` : '';
		return `Nå: underveis${mode} siden ${time}.`;
	}
	if (p.place?.name) return `Nå: på ${p.place.name} siden ${time}.`;
	return `Nå: på et sted uten navn siden ${time}.`;
}
