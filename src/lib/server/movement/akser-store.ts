/**
 * Lagring av Akser-tidslinjen og -stedene. Valideringen bor rent i
 * `$lib/domain/movement/`; her er bare databasen.
 *
 * ## Erstatt dagen
 *
 * En opplasting erstatter én Oslo-dag i sin helhet. Akser bygger dagen på nytt når
 * algoritmen endres, når brukeren retter og når fasit kommer inn, og
 * starttidspunktene flytter seg da — unikhetsindeksen på `sensor_events` ville
 * gjort hver revisjon til en duplikat. Slettingen er avgrenset til nøyaktig den
 * dagen og den sensoren, og skjer i samme transaksjon som innsettingen: samme regel
 * som «refresh sletter aldri mer enn den bygger opp igjen».
 *
 * ## Datatypene
 *
 * `movement_day` (én per dag, også en dag uten bevegelse), `movement_stay` og
 * `movement_journey`. ALDRI `workout` — samme tur skrives alt av opptil tre
 * kilder, og en fjerde ville telt med i kilometer, effort og streaks.
 *
 * Ingen koordinater i logglinjer. Linjene her kan leses over `/api/admin/logs`.
 */

import { and, eq, gte, inArray, lte, max, notInArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { appPlaceLinks, appPlaces, sensorEvents, sensors } from '$lib/db/schema';
import { osloDayBounds, type NormalizedDay } from '$lib/domain/movement/timeline';
import type { NormalizedPlace } from '$lib/domain/movement/places';

export const AKSER_APP_ID = 'akser';
export const MOVEMENT_DATA_TYPES = ['movement_day', 'movement_stay', 'movement_journey'];

const MAX_ERROR_LENGTH = 500;

/** Alle Aksers sted-id-er for brukeren, arkiverte medregnet. */
export async function listKnownPlaceIds(userId: string): Promise<Set<string>> {
	const rows = await db
		.select({ externalId: appPlaces.externalId })
		.from(appPlaces)
		.where(and(eq(appPlaces.userId, userId), eq(appPlaces.app, AKSER_APP_ID)));
	return new Set(rows.map((row) => row.externalId));
}

/**
 * Lagrer hele stedslista fra én app. Steder som ikke er med arkiveres; ingenting
 * slettes, siden gamle dager peker på dem. `app` er `akser` eller `ekko`.
 */
export async function savePlaces(
	userId: string,
	places: NormalizedPlace[],
	app: string = AKSER_APP_ID
): Promise<{ stored: number; archived: number }> {
	return db.transaction(async (tx) => {
		const now = new Date();
		if (places.length > 0) {
			await tx
				.insert(appPlaces)
				.values(
					places.map((place) => ({
						userId,
						app,
						externalId: place.externalId,
						name: place.name,
						category: place.category,
						latitude: place.latitude,
						longitude: place.longitude,
						radiusMeters: place.radiusMeters,
						named: place.named,
						archived: place.archived,
						updatedAt: now
					}))
				)
				.onConflictDoUpdate({
					target: [appPlaces.userId, appPlaces.app, appPlaces.externalId],
					set: {
						name: sql`excluded.name`,
						category: sql`excluded.category`,
						latitude: sql`excluded.latitude`,
						longitude: sql`excluded.longitude`,
						radiusMeters: sql`excluded.radius_meters`,
						named: sql`excluded.named`,
						archived: sql`excluded.archived`,
						updatedAt: now
					}
				});
		}

		const missing = [
			eq(appPlaces.userId, userId),
			eq(appPlaces.app, app),
			eq(appPlaces.archived, false)
		];
		if (places.length > 0) {
			missing.push(notInArray(appPlaces.externalId, places.map((place) => place.externalId)));
		}
		const archived = await tx
			.update(appPlaces)
			.set({ archived: true, updatedAt: now })
			.where(and(...missing))
			.returning({ id: appPlaces.id });

		return { stored: places.length, archived: archived.length };
	});
}

export async function placesUpdatedAt(userId: string): Promise<Date | null> {
	const [row] = await db
		.select({ updatedAt: max(appPlaces.updatedAt) })
		.from(appPlaces)
		.where(and(eq(appPlaces.userId, userId), eq(appPlaces.app, AKSER_APP_ID)));
	return row?.updatedAt ?? null;
}

/** Lagret `generatedAt` per dato, for dagene i en opplasting. */
export async function readStoredGenerations(
	userId: string,
	sensorId: string,
	dates: string[]
): Promise<Map<string, string>> {
	const result = new Map<string, string>();
	if (dates.length === 0) return result;
	const rows = await db
		.select({ data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.sensorId, sensorId),
				eq(sensorEvents.dataType, 'movement_day'),
				inArray(sql<string>`${sensorEvents.data}->>'date'`, dates)
			)
		);
	for (const row of rows) {
		const data = row.data as { date?: string; generatedAt?: string } | null;
		if (data?.date && data.generatedAt) result.set(data.date, data.generatedAt);
	}
	return result;
}

/** Erstatter én dag: sletter det som lå der og skriver det nye, i én transaksjon. */
export async function replaceDay(userId: string, sensorId: string, day: NormalizedDay): Promise<void> {
	const bounds = osloDayBounds(day.date);
	if (!bounds) throw new Error(`Ugyldig dato ${day.date}`);
	const metadata = { sourceApp: AKSER_APP_ID };

	await db.transaction(async (tx) => {
		await tx.delete(sensorEvents).where(dayRows(userId, sensorId, day.date, bounds));

		const rows = [
			{
				userId,
				sensorId,
				eventType: 'measurement',
				dataType: 'movement_day',
				timestamp: bounds.start,
				data: {
					date: day.date,
					generatedAt: day.generatedAt,
					detectorVersion: day.detectorVersion,
					stays: day.stays.length,
					journeys: day.journeys.length
				},
				metadata
			},
			...day.stays.map((stay) => ({
				userId,
				sensorId,
				eventType: 'state_change',
				dataType: 'movement_stay',
				timestamp: new Date(stay.startedAt),
				data: stay,
				metadata
			})),
			...day.journeys.map((journey) => ({
				userId,
				sensorId,
				eventType: 'activity',
				dataType: 'movement_journey',
				timestamp: new Date(journey.startedAt),
				data: journey,
				metadata
			}))
		];
		await tx.insert(sensorEvents).values(rows as (typeof sensorEvents.$inferInsert)[]);
	});
}

export async function deleteDay(userId: string, sensorId: string, date: string): Promise<number> {
	const bounds = osloDayBounds(date);
	if (!bounds) return 0;
	const deleted = await db
		.delete(sensorEvents)
		.where(dayRows(userId, sensorId, date, bounds))
		.returning({ id: sensorEvents.id });
	return deleted.length;
}

/**
 * Sletter hele tidslinjen og alle stedene fra Akser for brukeren, og koblingene mot
 * Ekkos steder — også de bekreftede, siden de bare finnes for Aksers steder.
 */
export async function deleteEverything(
	userId: string,
	sensorId: string | null
): Promise<{ events: number; places: number }> {
	return db.transaction(async (tx) => {
		const events = sensorId
			? await tx
					.delete(sensorEvents)
					.where(
						and(
							eq(sensorEvents.userId, userId),
							eq(sensorEvents.sensorId, sensorId),
							inArray(sensorEvents.dataType, MOVEMENT_DATA_TYPES)
						)
					)
					.returning({ id: sensorEvents.id })
			: [];
		const places = await tx
			.delete(appPlaces)
			.where(and(eq(appPlaces.userId, userId), eq(appPlaces.app, AKSER_APP_ID)))
			.returning({ id: appPlaces.id });
		await tx.delete(appPlaceLinks).where(eq(appPlaceLinks.userId, userId));
		return { events: events.length, places: places.length };
	});
}

export async function readDayStatus(
	userId: string,
	sensorId: string,
	from: { start: Date },
	to: { end: Date }
): Promise<Array<{ date: string; generatedAt: string; detectorVersion: string | null }>> {
	const rows = await db
		.select({ data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.sensorId, sensorId),
				eq(sensorEvents.dataType, 'movement_day'),
				gte(sensorEvents.timestamp, from.start),
				lte(sensorEvents.timestamp, to.end)
			)
		);
	return rows
		.map((row) => row.data as { date?: string; generatedAt?: string; detectorVersion?: string | null })
		.filter((data): data is { date: string; generatedAt: string; detectorVersion?: string | null } =>
			Boolean(data?.date && data.generatedAt)
		)
		.map((data) => ({
			date: data.date,
			generatedAt: data.generatedAt,
			detectorVersion: data.detectorVersion ?? null
		}))
		.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Appen har vært i kontakt. Skriver `lastSync` og `lastError` i samme oppdatering —
 * begge halvdelene, ellers blir en gammel feil stående etter at den er rettet.
 */
export async function recordContact(sensorId: string, lastError: string | null): Promise<void> {
	await db
		.update(sensors)
		.set({
			lastSync: new Date(),
			lastError: lastError ? lastError.slice(0, MAX_ERROR_LENGTH) : null,
			updatedAt: new Date()
		})
		.where(eq(sensors.id, sensorId));
}

/** Radene som hører til én dag. Tidsvinduet holder spørringen på indeksen; datoen avgjør. */
function dayRows(userId: string, sensorId: string, date: string, bounds: { start: Date; end: Date }) {
	return and(
		eq(sensorEvents.userId, userId),
		eq(sensorEvents.sensorId, sensorId),
		inArray(sensorEvents.dataType, MOVEMENT_DATA_TYPES),
		gte(sensorEvents.timestamp, bounds.start),
		lte(sensorEvents.timestamp, bounds.end),
		eq(sql<string>`${sensorEvents.data}->>'date'`, date)
	);
}
