/**
 * Lagring og lesing av «hvor er jeg nå» fra Akser. Reglene bor rent i
 * `$lib/domain/movement/presence.ts`.
 *
 * Ingen koordinater i logglinjer – linjene kan leses over `/api/admin/logs`.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { appPlaces, appPresence } from '$lib/db/schema';
import {
	isPresenceFresh,
	pickWeatherLocation,
	type NormalizedPresence,
	type PresenceState,
	type WeatherCandidate,
	type WeatherSource
} from '$lib/domain/movement/presence';
import { roundForWeather } from '$lib/domain/movement/home-place';
import type { MovementMode } from '$lib/domain/movement/timeline';
import { AKSER_APP_ID } from './akser-store';
import { readHomeLocation } from './home-location';

/** Lagrer signalet. Et eldre enn det lagrede skriver ingenting (`stale`). */
export async function savePresence(userId: string, p: NormalizedPresence): Promise<'stored' | 'stale'> {
	const existing = await db
		.select({ generatedAt: appPresence.generatedAt })
		.from(appPresence)
		.where(and(eq(appPresence.userId, userId), eq(appPresence.app, AKSER_APP_ID)))
		.limit(1);
	if (existing[0] && existing[0].generatedAt.getTime() > Date.parse(p.generatedAt)) return 'stale';

	const values = {
		state: p.state,
		placeExternalId: p.placeId,
		mode: p.mode,
		latitude: p.approx?.lat ?? null,
		longitude: p.approx?.lon ?? null,
		since: new Date(p.since),
		generatedAt: new Date(p.generatedAt),
		updatedAt: new Date()
	};
	await db
		.insert(appPresence)
		.values({ userId, app: AKSER_APP_ID, ...values })
		.onConflictDoUpdate({ target: [appPresence.userId, appPresence.app], set: values });
	return 'stored';
}

/** Delingen er slått av: det vi hadde, slettes. */
export async function deletePresence(userId: string): Promise<number> {
	const deleted = await db
		.delete(appPresence)
		.where(and(eq(appPresence.userId, userId), eq(appPresence.app, AKSER_APP_ID)))
		.returning({ id: appPresence.id });
	return deleted.length;
}

export interface CurrentPresence {
	state: PresenceState;
	since: string;
	mode: MovementMode | null;
	/** Stedet, når brukeren er på et kjent sted. Navnet bare når det er navngitt. */
	place: { name: string | null; category: string } | null;
	/** Hvor været skal hentes: stedets sentrum eller den avrundede posisjonen, ~1 km */
	weather: WeatherCandidate | null;
}

/** Signalet, bare når det fortsatt gjelder. Null ellers, også uten Akser. */
export async function readPresence(userId: string, now: Date = new Date()): Promise<CurrentPresence | null> {
	const rows = await db
		.select()
		.from(appPresence)
		.where(and(eq(appPresence.userId, userId), eq(appPresence.app, AKSER_APP_ID)))
		.limit(1);
	const row = rows[0];
	if (!row) return null;
	const state = row.state === 'journey' ? 'journey' : 'stay';
	if (!isPresenceFresh({ state, generatedAt: row.generatedAt.toISOString() }, now)) return null;

	let place: CurrentPresence['place'] = null;
	let weather: WeatherCandidate | null = null;
	if (row.placeExternalId) {
		const placeRows = await db
			.select({
				name: appPlaces.name,
				category: appPlaces.category,
				named: appPlaces.named,
				latitude: appPlaces.latitude,
				longitude: appPlaces.longitude
			})
			.from(appPlaces)
			.where(and(
				eq(appPlaces.userId, userId),
				eq(appPlaces.app, AKSER_APP_ID),
				eq(appPlaces.externalId, row.placeExternalId)
			))
			.limit(1);
		const p = placeRows[0];
		if (p) {
			place = { name: p.named ? p.name : null, category: p.category };
			weather = {
				name: p.named ? p.name : 'Der du er',
				latitude: roundForWeather(p.latitude),
				longitude: roundForWeather(p.longitude)
			};
		}
	}
	if (!weather && row.latitude !== null && row.longitude !== null) {
		weather = { name: 'Der du er', latitude: row.latitude, longitude: row.longitude };
	}

	return {
		state,
		since: row.since.toISOString(),
		mode: (row.mode as MovementMode | null) ?? null,
		place,
		weather
	};
}

/**
 * Været for en dag uten sted i planen: der du er (bare i dag), ellers hjemmet. Null
 * når ingen av dem finnes. Feiler stille – været skal komme fram uansett.
 */
export async function resolveWeatherLocation(
	userId: string,
	day: string,
	today: string
): Promise<(WeatherCandidate & { source: WeatherSource }) | null> {
	try {
		const [presence, home] = await Promise.all([
			day === today ? readPresence(userId) : Promise.resolve(null),
			readHomeLocation(userId)
		]);
		return pickWeatherLocation({ day, today, now: presence?.weather ?? null, home });
	} catch (err) {
		console.warn('[akser] værsted kunne ikke leses:', err instanceof Error ? err.message : err);
		return null;
	}
}
