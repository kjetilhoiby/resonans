/**
 * Akser-tidslinjen: validering og normalisering av én Oslo-dag fra appen.
 *
 * Kontrakten står i `docs/akser-tidslinje.md`, planen i
 * `docs/changelog/2026-10-06-akser-integrasjon.md`. Fila er ren — endepunktet i
 * `routes/api/apps/akser/timeline` gjør lagringen.
 *
 * ## Felt for felt, aldri med en spread
 *
 * Alt som lagres bygges av navngitte felt (samme regel som `toPublicCronRun` og
 * `buildTicketDraft`). Det er tidslinjen som er personvernsgrensa: legger Akser til
 * et felt senere — et spor, en adresse — skal det ikke havne i basen fordi noen
 * videresendte objektet.
 *
 * ## En ukjent verdi avvises, den gjettes ikke
 *
 * En transportform eller et sted vi ikke kjenner gir en feil på dagen. En stille
 * default som gjetter en KONKRET verdi er verre enn et avslag — `startWorkout.type`
 * gjorde en elsykkeltur til en løpeøkt på den måten.
 */

import { osloWallClockToUtc } from '$lib/domain/oslo-time';

export const MOVEMENT_MODES = [
	'walking',
	'running',
	'cycling',
	'e_bike',
	'driving',
	'transit',
	'unknown'
] as const;
export type MovementMode = (typeof MOVEMENT_MODES)[number];

/** Hvor transportformen kom fra. Akser velger i denne rekkefølgen: user > label > auto. */
export const MODE_SOURCES = ['user', 'label', 'auto'] as const;
export type ModeSource = (typeof MODE_SOURCES)[number];

export const MAX_DAYS_PER_UPLOAD = 31;
export const MAX_ENTRIES_PER_DAY = 500;
export const MAX_LEGS_PER_JOURNEY = 50;
/** En reise lengre enn dette på én dag er en feil i enheten, ikke en reise. */
export const MAX_DISTANCE_METERS = 3_000_000;

/**
 * Sentrum på et ukjent sted lagres med tre desimaler (~100 m nord–sør). Akser
 * avrunder selv, men grensa håndheves der dataene lagres: en klient som glemmer det
 * skal ikke kunne legge en husadresse i basen.
 */
export const CENTER_DECIMALS = 3;

export type TimelineErrorCode =
	| 'invalid_date'
	| 'invalid_entry'
	| 'outside_day'
	| 'overlap'
	| 'unknown_mode'
	| 'unknown_place'
	| 'invalid_leg';

export interface StoredStay {
	date: string;
	startedAt: string;
	endedAt: string;
	/** Aksers sted-id. Null når oppholdet ikke ligger på et kjent sted. */
	placeId: string | null;
	/** Bare når `placeId` er null, avrundet til `CENTER_DECIMALS`. */
	center: { lat: number; lon: number } | null;
}

export interface StoredLeg {
	mode: MovementMode;
	modeSource: ModeSource;
	confidence: number | null;
	startedAt: string;
	endedAt: string;
	distanceMeters: number;
	/** `id` fra `/api/apps/workouts` når `modeSource` er `label`. En opplysning, ikke en nøkkel. */
	labelRef: string | null;
}

export interface StoredJourney {
	date: string;
	startedAt: string;
	endedAt: string;
	fromPlaceId: string | null;
	toPlaceId: string | null;
	distanceMeters: number;
	legs: StoredLeg[];
}

export interface NormalizedDay {
	date: string;
	generatedAt: string;
	detectorVersion: string | null;
	stays: StoredStay[];
	journeys: StoredJourney[];
}

export type DayResult =
	| { ok: true; day: NormalizedDay }
	| { ok: false; date: string | null; code: TimelineErrorCode; message: string };

export type EnvelopeResult = { ok: true; days: unknown[] } | { ok: false; message: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Et tidspunkt uten offset tolkes i serverens tidssone, og den er UTC i drift. */
const ISO_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Kroppen er `{ days: [...] }` med 1–31 dager. Alt annet er en feil i hele kallet. */
export function parseTimelineEnvelope(body: unknown): EnvelopeResult {
	if (!isRecord(body) || !Array.isArray(body.days)) {
		return { ok: false, message: 'Forventet { days: [...] }' };
	}
	if (body.days.length === 0) return { ok: false, message: 'days er tom' };
	if (body.days.length > MAX_DAYS_PER_UPLOAD) {
		return { ok: false, message: `Høyst ${MAX_DAYS_PER_UPLOAD} dager per kall` };
	}
	return { ok: true, days: body.days };
}

/** Oslo-døgnet som et halvåpent UTC-intervall. Null for en ugyldig dato. */
export function osloDayBounds(date: string): { start: Date; end: Date } | null {
	if (!DATE_RE.test(date)) return null;
	const parsed = new Date(`${date}T00:00:00.000Z`);
	if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
	const next = new Date(parsed.getTime() + 24 * 3600_000).toISOString().slice(0, 10);
	const start = osloWallClockToUtc(date, '00:00');
	const end = osloWallClockToUtc(next, '00:00');
	if (!start || !end) return null;
	return { start, end };
}

/**
 * Er det vi har lagret nyere enn det som kommer inn? Da er opplastingen et gammelt
 * forsøk som kom fram sent, og den skal ikke overskrive en rettelse. Lik
 * generering er ikke foreldet — et nytt forsøk på samme opplasting skal virke.
 */
export function isStale(storedGeneratedAt: string | null | undefined, incoming: string): boolean {
	if (!storedGeneratedAt) return false;
	const stored = Date.parse(storedGeneratedAt);
	const next = Date.parse(incoming);
	if (Number.isNaN(stored) || Number.isNaN(next)) return false;
	return stored > next;
}

export function roundCoordinate(value: number): number {
	const factor = 10 ** CENTER_DECIMALS;
	return Math.round(value * factor) / factor;
}

/** Alle sted-id-er dagen peker på, så kalleren kan slå dem opp før normaliseringen. */
export function referencedPlaceIds(raw: unknown): string[] {
	if (!isRecord(raw) || !Array.isArray(raw.entries)) return [];
	const ids = new Set<string>();
	for (const entry of raw.entries) {
		if (!isRecord(entry)) continue;
		for (const key of ['placeId', 'fromPlaceId', 'toPlaceId']) {
			const value = entry[key];
			if (typeof value === 'string' && value.length > 0) ids.add(value);
		}
	}
	return [...ids];
}

/**
 * Validerer og normaliserer én dag. `knownPlaceIds` er Aksers sted-id-er vi har fått
 * gjennom `PUT /api/apps/akser/places`, arkiverte medregnet — en gammel dag som
 * bygges på nytt kan peke på et sted brukeren siden har ryddet bort.
 */
export function normalizeTimelineDay(raw: unknown, knownPlaceIds: ReadonlySet<string>): DayResult {
	if (!isRecord(raw)) return fail(null, 'invalid_entry', 'Dagen er ikke et objekt');

	const date = typeof raw.date === 'string' ? raw.date : null;
	const bounds = date ? osloDayBounds(date) : null;
	if (!date || !bounds) return fail(date, 'invalid_date', 'date må være en gyldig YYYY-MM-DD');

	const generatedAt = parseInstant(raw.generatedAt);
	if (!generatedAt) {
		return fail(date, 'invalid_entry', 'generatedAt må være ISO 8601 med offset');
	}

	let detectorVersion: string | null = null;
	if (raw.detectorVersion !== undefined && raw.detectorVersion !== null) {
		if (typeof raw.detectorVersion !== 'string' || raw.detectorVersion.length > 64) {
			return fail(date, 'invalid_entry', 'detectorVersion må være tekst på høyst 64 tegn');
		}
		detectorVersion = raw.detectorVersion;
	}

	if (!Array.isArray(raw.entries)) return fail(date, 'invalid_entry', 'entries mangler');
	if (raw.entries.length > MAX_ENTRIES_PER_DAY) {
		return fail(date, 'invalid_entry', `Høyst ${MAX_ENTRIES_PER_DAY} oppføringer per dag`);
	}

	const stays: StoredStay[] = [];
	const journeys: StoredJourney[] = [];
	let previousEnd: Date | null = null;

	for (let i = 0; i < raw.entries.length; i++) {
		const entry = raw.entries[i];
		const path = `entries[${i}]`;
		if (!isRecord(entry)) return fail(date, 'invalid_entry', `${path} er ikke et objekt`);

		const span = parseSpan(entry, path);
		if ('error' in span) return fail(date, 'invalid_entry', span.error);
		if (span.start < bounds.start || span.end > bounds.end) {
			return fail(date, 'outside_day', `${path} ligger utenfor ${date} (Oslo)`);
		}
		if (previousEnd && span.start < previousEnd) {
			return fail(date, 'overlap', `${path} starter før forrige oppføring slutter`);
		}
		previousEnd = span.end;

		if (entry.kind === 'stay') {
			const placeId = optionalId(entry.placeId);
			if (placeId === undefined) return fail(date, 'invalid_entry', `${path}.placeId må være tekst eller null`);
			if (placeId && !knownPlaceIds.has(placeId)) {
				return fail(date, 'unknown_place', `${path}.placeId finnes ikke i stedslista`);
			}
			let center: StoredStay['center'] = null;
			if (!placeId) {
				const parsed = parseCenter(entry.center);
				if (!parsed) {
					return fail(date, 'invalid_entry', `${path}.center må ha lat og lon når placeId er null`);
				}
				center = parsed;
			}
			stays.push({
				date,
				startedAt: span.start.toISOString(),
				endedAt: span.end.toISOString(),
				placeId,
				center
			});
			continue;
		}

		if (entry.kind === 'journey') {
			const fromPlaceId = optionalId(entry.fromPlaceId);
			const toPlaceId = optionalId(entry.toPlaceId);
			if (fromPlaceId === undefined || toPlaceId === undefined) {
				return fail(date, 'invalid_entry', `${path}.fromPlaceId/toPlaceId må være tekst eller null`);
			}
			for (const [key, id] of [['fromPlaceId', fromPlaceId], ['toPlaceId', toPlaceId]] as const) {
				if (id && !knownPlaceIds.has(id)) {
					return fail(date, 'unknown_place', `${path}.${key} finnes ikke i stedslista`);
				}
			}
			const distanceMeters = parseDistance(entry.distanceMeters);
			if (distanceMeters === null) {
				return fail(date, 'invalid_entry', `${path}.distanceMeters må være et tall mellom 0 og ${MAX_DISTANCE_METERS}`);
			}
			const legs = parseLegs(entry.legs, span, path);
			if ('code' in legs) return fail(date, legs.code, legs.message);
			journeys.push({
				date,
				startedAt: span.start.toISOString(),
				endedAt: span.end.toISOString(),
				fromPlaceId,
				toPlaceId,
				distanceMeters,
				legs: legs.legs
			});
			continue;
		}

		return fail(date, 'invalid_entry', `${path}.kind må være stay eller journey`);
	}

	return {
		ok: true,
		day: { date, generatedAt: generatedAt.toISOString(), detectorVersion, stays, journeys }
	};
}

function parseLegs(
	raw: unknown,
	journey: { start: Date; end: Date },
	journeyPath: string
): { legs: StoredLeg[] } | { code: TimelineErrorCode; message: string } {
	if (!Array.isArray(raw) || raw.length === 0) {
		return { code: 'invalid_leg', message: `${journeyPath}.legs må ha minst én etappe` };
	}
	if (raw.length > MAX_LEGS_PER_JOURNEY) {
		return { code: 'invalid_leg', message: `${journeyPath}.legs har mer enn ${MAX_LEGS_PER_JOURNEY} etapper` };
	}

	const legs: StoredLeg[] = [];
	let previousEnd: Date | null = null;
	for (let j = 0; j < raw.length; j++) {
		const leg = raw[j];
		const path = `${journeyPath}.legs[${j}]`;
		if (!isRecord(leg)) return { code: 'invalid_leg', message: `${path} er ikke et objekt` };

		const span = parseSpan(leg, path);
		if ('error' in span) return { code: 'invalid_leg', message: span.error };
		if (span.start < journey.start || span.end > journey.end) {
			return { code: 'invalid_leg', message: `${path} ligger utenfor reisen` };
		}
		if (previousEnd && span.start < previousEnd) {
			return { code: 'invalid_leg', message: `${path} starter før forrige etappe slutter` };
		}
		previousEnd = span.end;

		if (!isOneOf(MOVEMENT_MODES, leg.mode)) {
			return { code: 'unknown_mode', message: `${path}.mode er ukjent: ${String(leg.mode)}` };
		}
		if (!isOneOf(MODE_SOURCES, leg.modeSource)) {
			return { code: 'invalid_leg', message: `${path}.modeSource må være user, label eller auto` };
		}

		let confidence: number | null = null;
		if (leg.confidence !== undefined && leg.confidence !== null) {
			if (typeof leg.confidence !== 'number' || !(leg.confidence >= 0 && leg.confidence <= 1)) {
				return { code: 'invalid_leg', message: `${path}.confidence må være mellom 0 og 1` };
			}
			confidence = leg.confidence;
		}

		const distanceMeters = parseDistance(leg.distanceMeters);
		if (distanceMeters === null) {
			return { code: 'invalid_leg', message: `${path}.distanceMeters må være et tall mellom 0 og ${MAX_DISTANCE_METERS}` };
		}

		const labelRef = optionalId(leg.labelRef);
		if (labelRef === undefined) {
			return { code: 'invalid_leg', message: `${path}.labelRef må være tekst eller null` };
		}

		legs.push({
			mode: leg.mode,
			modeSource: leg.modeSource,
			confidence,
			startedAt: span.start.toISOString(),
			endedAt: span.end.toISOString(),
			distanceMeters,
			labelRef
		});
	}
	return { legs };
}

function parseSpan(
	value: Record<string, unknown>,
	path: string
): { start: Date; end: Date } | { error: string } {
	const start = parseInstant(value.startedAt);
	const end = parseInstant(value.endedAt);
	if (!start || !end) return { error: `${path}.startedAt/endedAt må være ISO 8601 med offset` };
	if (end <= start) return { error: `${path} slutter før den starter` };
	return { start, end };
}

function parseInstant(value: unknown): Date | null {
	if (typeof value !== 'string' || !ISO_WITH_OFFSET_RE.test(value)) return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseCenter(value: unknown): { lat: number; lon: number } | null {
	if (!isRecord(value)) return null;
	const { lat, lon } = value;
	if (typeof lat !== 'number' || typeof lon !== 'number') return null;
	if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) return null;
	return { lat: roundCoordinate(lat), lon: roundCoordinate(lon) };
}

function parseDistance(value: unknown): number | null {
	if (typeof value !== 'number' || !(value >= 0 && value <= MAX_DISTANCE_METERS)) return null;
	return Math.round(value);
}

/** Tekst-id, null eller fraværende → id/null. Alt annet → undefined (ugyldig). */
function optionalId(value: unknown): string | null | undefined {
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string' || value.length === 0 || value.length > 128) return undefined;
	return value;
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
	return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(date: string | null, code: TimelineErrorCode, message: string): DayResult {
	return { ok: false, date, code, message };
}
