/**
 * Leser Akser-tidslinjen for chatten og dagskonteksten. Reglene for hva radene
 * betyr bor i `$lib/domain/movement/movement-summary.ts`.
 *
 * Bare radene Akser selv har skrevet (`movement_stay`/`movement_journey` under
 * Akser-sensoren). Datoen i `data` avgjør hvilken dag en rad hører til; tidsvinduet
 * på `timestamp` holder spørringen på indeksen, med ett døgns slakk i hver ende
 * fordi et opphold som krysser midnatt står med sin egen dato.
 */

import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { appPlaces, sensorEvents } from '$lib/db/schema';
import { getAppConfig } from '$lib/server/app-registry';
import { findAppSensorId } from '$lib/server/app-sensor';
import { osloDayBounds, type StoredJourney, type StoredStay } from '$lib/domain/movement/timeline';
import type { MovementData, MovementPlace } from '$lib/domain/movement/movement-summary';
import type { PlaceCategory } from '$lib/domain/movement/places';
import { AKSER_APP_ID } from './akser-store';

export type MovementRead =
	| { connected: false }
	| { connected: true; data: MovementData; firstDate: string | null };

/** `from`/`to` er Oslo-datoer, begge med. */
export async function readMovement(userId: string, from: string, to: string): Promise<MovementRead> {
	const app = getAppConfig(AKSER_APP_ID);
	const sensorId = app ? await findAppSensorId(userId, app) : null;
	if (!sensorId) return { connected: false };

	const start = osloDayBounds(from)?.start;
	const end = osloDayBounds(to)?.end;
	if (!start || !end) throw new Error(`Ugyldig datovindu: ${from}–${to}`);

	const [rows, placeRows, first] = await Promise.all([
		db
			.select({ dataType: sensorEvents.dataType, data: sensorEvents.data })
			.from(sensorEvents)
			.where(
				and(
					eq(sensorEvents.userId, userId),
					eq(sensorEvents.sensorId, sensorId),
					inArray(sensorEvents.dataType, ['movement_stay', 'movement_journey']),
					gte(sensorEvents.timestamp, new Date(start.getTime() - 86_400_000)),
					lte(sensorEvents.timestamp, new Date(end.getTime() + 86_400_000)),
					gte(sql<string>`${sensorEvents.data}->>'date'`, from),
					lte(sql<string>`${sensorEvents.data}->>'date'`, to)
				)
			),
		readAkserPlaces(userId),
		db
			.select({ date: sql<string | null>`min(${sensorEvents.data}->>'date')` })
			.from(sensorEvents)
			.where(
				and(
					eq(sensorEvents.userId, userId),
					eq(sensorEvents.sensorId, sensorId),
					eq(sensorEvents.dataType, 'movement_day')
				)
			)
	]);

	const stays: StoredStay[] = [];
	const journeys: StoredJourney[] = [];
	for (const row of rows) {
		if (row.dataType === 'movement_stay') stays.push(row.data as StoredStay);
		else journeys.push(row.data as StoredJourney);
	}

	return { connected: true, data: { stays, journeys, places: placeRows }, firstDate: first[0]?.date ?? null };
}

/** Aksers steder, arkiverte med: gamle dager peker på dem. Aldri koordinatene. */
export async function readAkserPlaces(userId: string): Promise<MovementPlace[]> {
	const rows = await db
		.select({
			id: appPlaces.externalId,
			name: appPlaces.name,
			category: appPlaces.category,
			named: appPlaces.named,
			archived: appPlaces.archived
		})
		.from(appPlaces)
		.where(and(eq(appPlaces.userId, userId), eq(appPlaces.app, AKSER_APP_ID)));
	return rows.map((row) => ({ ...row, category: row.category as PlaceCategory }));
}
