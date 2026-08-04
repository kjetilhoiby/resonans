/**
 * Loggen for selvrapportert sult.
 *
 * Egen `dataType: 'hunger'` under den eksisterende `manual`/`nutrition_log`-sensoren —
 * ikke `'nutrition'`. Alt som leser `'nutrition'` summerer makroer (`summarizeDay`,
 * `aggregateDailyEffort`, `listIntake`), og en sultmelding uten kalorier ville blitt et
 * måltid på 0 kcal i dagssummen. Samme grunn som `sleep_disturbance` er skilt fra
 * `sleep`.
 *
 * **Gapet lagres med meldingen.** Å regne det ut i ettertid ville krevd å rekonstruere
 * hvilken kroppsprofil og hvilke økter som gjaldt den dagen — og profilen kan endres.
 * Tallet slik det var da brukeren kjente sulten er det som skal brukes videre.
 */

import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents, sensors } from '$lib/db/schema';
import {
	isHungerLevel,
	type HungerObservation
} from '$lib/domain/nutrition/hunger';
import {
	NUTRITION_PROVIDER,
	NUTRITION_SENSOR_TYPE,
	ensureNutritionSensor
} from '$lib/server/nutrition/intake-log';

export const HUNGER_DATA_TYPE = 'hunger';

async function nutritionSensorIds(userId: string): Promise<string[]> {
	const rows = await db.query.sensors.findMany({
		columns: { id: true },
		where: and(
			eq(sensors.userId, userId),
			eq(sensors.provider, NUTRITION_PROVIDER),
			eq(sensors.type, NUTRITION_SENSOR_TYPE)
		)
	});
	return rows.map((row) => row.id);
}

export interface LogHungerInput {
	userId: string;
	level: number;
	timestamp?: Date;
	/** Kumulativt gap (forbrent − spist) nå. Null når kroppsprofilen mangler. */
	gapKcal?: number | null;
	/** Kcal spist så langt, til etterprøving av gapet. */
	intakeKcal?: number | null;
	osloHour?: number | null;
	note?: string | null;
}

export async function logHunger(
	input: LogHungerInput
): Promise<{ id: string; timestamp: string } | null> {
	if (!isHungerLevel(input.level)) return null;

	const sensorId = await ensureNutritionSensor(input.userId);
	const timestamp = input.timestamp ?? new Date();

	const num = (value: unknown): number | null =>
		typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;

	const [created] = await db
		.insert(sensorEvents)
		.values({
			userId: input.userId,
			sensorId,
			eventType: 'measurement',
			dataType: HUNGER_DATA_TYPE,
			timestamp,
			data: {
				hungerLevel: input.level,
				gapKcal: num(input.gapKcal),
				intakeKcal: num(input.intakeKcal),
				osloHour:
					typeof input.osloHour === 'number' && Number.isFinite(input.osloHour)
						? Math.round(input.osloHour * 100) / 100
						: null,
				...(input.note?.trim() ? { note: input.note.trim() } : {})
			},
			metadata: { source: 'hunger-scale', manual: true }
		})
		.returning({ id: sensorEvents.id, timestamp: sensorEvents.timestamp });

	return { id: created.id, timestamp: created.timestamp.toISOString() };
}

/** Sultmeldingene i et vindu bakover, nyeste først. */
export async function listHunger(
	userId: string,
	opts: { sinceDays?: number; limit?: number } = {}
): Promise<HungerObservation[]> {
	const sensorIds = await nutritionSensorIds(userId);
	if (sensorIds.length === 0) return [];

	const since = new Date(Date.now() - (opts.sinceDays ?? 90) * 24 * 60 * 60 * 1000);

	const rows = await db
		.select({ id: sensorEvents.id, timestamp: sensorEvents.timestamp, data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, HUNGER_DATA_TYPE),
				inArray(sensorEvents.sensorId, sensorIds),
				gte(sensorEvents.timestamp, since)
			)
		)
		.orderBy(desc(sensorEvents.timestamp))
		.limit(opts.limit ?? 200);

	return rows.flatMap((row) => {
		const data = (row.data ?? {}) as Record<string, unknown>;
		// Ukjent nivå droppes framfor å vises som noe det ikke er.
		if (!isHungerLevel(data.hungerLevel)) return [];
		const num = (value: unknown): number | null =>
			typeof value === 'number' && Number.isFinite(value) ? value : null;
		return [
			{
				at: row.timestamp.toISOString(),
				level: data.hungerLevel,
				gapKcal: num(data.gapKcal),
				osloHour: num(data.osloHour)
			}
		];
	});
}

export async function deleteHunger(userId: string, eventId: string): Promise<boolean> {
	const deleted = await db
		.delete(sensorEvents)
		.where(
			and(
				eq(sensorEvents.id, eventId),
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, HUNGER_DATA_TYPE)
			)
		)
		.returning({ id: sensorEvents.id });

	return deleted.length > 0;
}
