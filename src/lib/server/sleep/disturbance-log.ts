import { db } from '$lib/db';
import { sensorEvents, sensors } from '$lib/db/schema';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import {
	isSleepDisturbanceKind,
	MAX_AWAKE_MINUTES,
	type LoggedDisturbance,
	type SleepDisturbanceKind
} from '$lib/domain/sleep/disturbance';

/**
 * Loggen for selvrapporterte søvnforstyrrelser.
 *
 * Egen `dataType` — ikke `'sleep'`. Alt nedstrøms som leser `dataType: 'sleep'`
 * antar at hendelsen har en varighet: `toSleepNights` dropper events uten
 * brukbar varighet, `aggregateWeeklyData` snitter `sleepDuration`, og
 * `isNapSleepEvent` klassifiserer på lengde. En «fikk ikke sove»-hendelse har
 * ingen varighet, og å gi den `sleepDuration: 0` ville dratt nattsnittet ned —
 * altså ødelagt nøyaktig det tallet man ser etter når man sover dårlig.
 *
 * NB: naps bruker den eldre `manual_nap`-provideren (se
 * `server/integrations/sleep-goals.ts`). Den er bevisst ikke migrert: skrivestien
 * er live i både chat-verktøyet og assistenten, og provider-strengen er kosmetisk.
 */

export const DISTURBANCE_PROVIDER = 'manual';
export const DISTURBANCE_SENSOR_TYPE = 'sleep_log';
export const DISTURBANCE_DATA_TYPE = 'sleep_disturbance';

/** Opprettes ved første registrering, ikke ved første sidevisning. */
async function ensureDisturbanceSensor(userId: string): Promise<string> {
	const existing = await db.query.sensors.findFirst({
		columns: { id: true },
		where: and(
			eq(sensors.userId, userId),
			eq(sensors.provider, DISTURBANCE_PROVIDER),
			eq(sensors.type, DISTURBANCE_SENSOR_TYPE)
		)
	});
	if (existing) return existing.id;

	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: DISTURBANCE_PROVIDER,
			type: DISTURBANCE_SENSOR_TYPE,
			subtype: 'disturbance',
			name: 'Søvnlogg',
			isActive: true
		})
		.returning({ id: sensors.id });

	return created.id;
}

async function disturbanceSensorIds(userId: string): Promise<string[]> {
	const rows = await db.query.sensors.findMany({
		columns: { id: true },
		where: and(
			eq(sensors.userId, userId),
			eq(sensors.provider, DISTURBANCE_PROVIDER),
			eq(sensors.type, DISTURBANCE_SENSOR_TYPE)
		)
	});
	return rows.map((row) => row.id);
}

export interface LogDisturbanceInput {
	userId: string;
	kind: SleepDisturbanceKind;
	/** Når det skjedde. Standard nå. */
	timestamp?: Date;
	/** Minutter våken, når brukeren vet. Utelates ellers — «vet ikke» er et svar. */
	awakeMinutes?: number | null;
	note?: string | null;
}

export async function logDisturbance(
	input: LogDisturbanceInput
): Promise<{ id: string; timestamp: string }> {
	const sensorId = await ensureDisturbanceSensor(input.userId);
	const timestamp = input.timestamp ?? new Date();

	const awakeMinutes =
		typeof input.awakeMinutes === 'number' &&
		Number.isFinite(input.awakeMinutes) &&
		input.awakeMinutes >= 0 &&
		input.awakeMinutes <= MAX_AWAKE_MINUTES
			? Math.round(input.awakeMinutes)
			: null;

	const [created] = await db
		.insert(sensorEvents)
		.values({
			userId: input.userId,
			sensorId,
			eventType: 'measurement',
			dataType: DISTURBANCE_DATA_TYPE,
			timestamp,
			data: {
				disturbanceKind: input.kind,
				...(awakeMinutes !== null ? { awakeMinutes } : {}),
				...(input.note?.trim() ? { note: input.note.trim() } : {})
			},
			metadata: { source: 'sleep-logger', manual: true }
		})
		.returning({ id: sensorEvents.id, timestamp: sensorEvents.timestamp });

	return { id: created.id, timestamp: created.timestamp.toISOString() };
}

export async function deleteDisturbance(userId: string, eventId: string): Promise<boolean> {
	const deleted = await db
		.delete(sensorEvents)
		.where(
			and(
				eq(sensorEvents.id, eventId),
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, DISTURBANCE_DATA_TYPE)
			)
		)
		.returning({ id: sensorEvents.id });

	return deleted.length > 0;
}

/** Forstyrrelsene i et vindu bakover, nyeste først. */
export async function listDisturbances(
	userId: string,
	opts: { sinceDays?: number; limit?: number } = {}
): Promise<LoggedDisturbance[]> {
	const sensorIds = await disturbanceSensorIds(userId);
	if (sensorIds.length === 0) return [];

	const since = new Date(Date.now() - (opts.sinceDays ?? 30) * 24 * 60 * 60 * 1000);

	const rows = await db
		.select({
			id: sensorEvents.id,
			timestamp: sensorEvents.timestamp,
			data: sensorEvents.data
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				inArray(sensorEvents.sensorId, sensorIds),
				gte(sensorEvents.timestamp, since)
			)
		)
		.orderBy(desc(sensorEvents.timestamp))
		.limit(opts.limit ?? 200);

	return rows.flatMap((row) => {
		const data = (row.data ?? {}) as Record<string, unknown>;
		// Ukjent kind droppes framfor å vises som noe den ikke er.
		if (!isSleepDisturbanceKind(data.disturbanceKind)) return [];
		return [
			{
				id: row.id,
				timestamp: row.timestamp.toISOString(),
				kind: data.disturbanceKind,
				awakeMinutes:
					typeof data.awakeMinutes === 'number' && Number.isFinite(data.awakeMinutes)
						? data.awakeMinutes
						: null,
				note: typeof data.note === 'string' && data.note ? data.note : null
			}
		];
	});
}
