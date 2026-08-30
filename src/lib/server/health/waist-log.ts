/**
 * Loggen for livvidde.
 *
 * Egen `dataType: 'waist'` under en `manual`/`body_log`-sensor. **Ikke** under
 * ernæringssensoren og ikke som `'weight'`: alt som leser `'weight'` antar
 * kilogram og en måling fra vekta, og en livvidde i den strømmen ville blitt
 * lest som en vekt på 94 kg. Samme grunn som `sleep_disturbance` er skilt fra
 * `sleep` og `hunger` fra `nutrition`.
 *
 * Sensoren heter `body_log` framfor `waist_log` fordi den er ment å bære flere
 * manuelle kroppsmål senere (hofte, bryst) uten at det trengs en ny sensor per
 * mål. Skillet mellom dem er `dataType`.
 */

import { and, asc, desc, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents, sensors } from '$lib/db/schema';
import { osloDayKey } from '$lib/domain/oslo-time';
import { validateWaistCm, type WaistMeasurement } from '$lib/domain/health/waist';

export const BODY_LOG_PROVIDER = 'manual';
export const BODY_LOG_SENSOR_TYPE = 'body_log';
export const WAIST_DATA_TYPE = 'waist';

export async function ensureBodyLogSensor(userId: string): Promise<string> {
	const existing = await db.query.sensors.findFirst({
		columns: { id: true },
		where: and(
			eq(sensors.userId, userId),
			eq(sensors.provider, BODY_LOG_PROVIDER),
			eq(sensors.type, BODY_LOG_SENSOR_TYPE)
		)
	});
	if (existing) return existing.id;

	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: BODY_LOG_PROVIDER,
			type: BODY_LOG_SENSOR_TYPE,
			subtype: 'manual',
			name: 'Kroppsmål',
			isActive: true
		})
		.returning({ id: sensors.id });

	return created.id;
}

export interface LogWaistInput {
	userId: string;
	waistCm: number;
	/** Uten den brukes nå. Flaten sender den når brukeren retter et tidspunkt. */
	timestamp?: Date;
	note?: string | null;
}

export interface StoredWaistMeasurement extends WaistMeasurement {
	id: string;
	timestamp: string;
	note: string | null;
}

/**
 * Skriver én måling.
 *
 * Returnerer `null` på ugyldig verdi framfor å kaste: kallerne er et endepunkt
 * som skal svare 400 med en forklaring, og validatoren eier teksten.
 */
export async function logWaist(input: LogWaistInput): Promise<StoredWaistMeasurement | null> {
	if (validateWaistCm(input.waistCm) !== null) return null;

	const sensorId = await ensureBodyLogSensor(input.userId);
	const timestamp = input.timestamp ?? new Date();
	const note = input.note?.trim() ? input.note.trim() : null;

	const [created] = await db
		.insert(sensorEvents)
		.values({
			userId: input.userId,
			sensorId,
			eventType: 'measurement',
			dataType: WAIST_DATA_TYPE,
			timestamp,
			data: { waistCm: input.waistCm, note },
			metadata: { source: 'manual_waist_log' }
		})
		.returning({ id: sensorEvents.id, timestamp: sensorEvents.timestamp });

	return {
		id: created.id,
		timestamp: created.timestamp.toISOString(),
		date: osloDayKey(created.timestamp),
		waistCm: input.waistCm,
		note
	};
}

/**
 * Målingene i vinduet, nyeste sist.
 *
 * Datoen er Oslo-døgnet, ikke UTC: en måling kl. 00:30 norsk tid hører til den
 * dagen brukeren opplevde, og trenden grupperer på det samme.
 *
 * ## Leser på tvers av sensorer, med vilje
 *
 * Filteret er bruker + datatype, ikke sensor — samme konvensjon som alle
 * vektleserne i repoet. Første utgave gjorde et oppslag på `body_log`-sensoren og
 * returnerte tom liste hvis den ikke fantes. Det var en fungerende bug som ventet
 * på HealthKit-importen: den skriver livvidde under `healthkit`-sensoren, så en
 * bruker som aldri hadde logget manuelt ville fått en **usynlig** import — data i
 * basen, tom flate, ingen feilmelding.
 */
export async function listWaistMeasurements(
	userId: string,
	{ sinceDays }: { sinceDays?: number } = {}
): Promise<StoredWaistMeasurement[]> {
	const filters = [
		eq(sensorEvents.userId, userId),
		eq(sensorEvents.dataType, WAIST_DATA_TYPE)
	];
	if (sinceDays !== undefined) {
		filters.push(gte(sensorEvents.timestamp, new Date(Date.now() - sinceDays * 86_400_000)));
	}

	const rows = await db
		.select({
			id: sensorEvents.id,
			timestamp: sensorEvents.timestamp,
			data: sensorEvents.data
		})
		.from(sensorEvents)
		.where(and(...filters))
		.orderBy(asc(sensorEvents.timestamp));

	return rows
		.map((row) => {
			const data = (row.data ?? {}) as { waistCm?: number; note?: string | null };
			return {
				id: row.id,
				timestamp: row.timestamp.toISOString(),
				date: osloDayKey(row.timestamp),
				waistCm: typeof data.waistCm === 'number' ? data.waistCm : NaN,
				note: data.note ?? null
			};
		})
		.filter((row) => Number.isFinite(row.waistCm));
}

/**
 * Sletter én måling.
 *
 * Bare våre egne rader kan slettes — filteret på `dataType` er det som sikrer
 * det, siden en id fra en annen datatype ellers ville truffet en Withings-rad.
 * Returnerer om noe faktisk ble slettet, så endepunktet kan svare 404 framfor å
 * late som.
 */
export async function deleteWaistMeasurement(userId: string, id: string): Promise<boolean> {
	const deleted = await db
		.delete(sensorEvents)
		.where(
			and(
				eq(sensorEvents.id, id),
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, WAIST_DATA_TYPE)
			)
		)
		.returning({ id: sensorEvents.id });

	return deleted.length > 0;
}

/** Siste måling, uten å laste hele historikken. */
export async function latestWaistMeasurement(
	userId: string
): Promise<StoredWaistMeasurement | null> {
	const rows = await db
		.select({ id: sensorEvents.id, timestamp: sensorEvents.timestamp, data: sensorEvents.data })
		.from(sensorEvents)
		.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, WAIST_DATA_TYPE)))
		.orderBy(desc(sensorEvents.timestamp))
		.limit(1);

	const row = rows[0];
	if (!row) return null;
	const data = (row.data ?? {}) as { waistCm?: number; note?: string | null };
	if (typeof data.waistCm !== 'number') return null;

	return {
		id: row.id,
		timestamp: row.timestamp.toISOString(),
		date: osloDayKey(row.timestamp),
		waistCm: data.waistCm,
		note: data.note ?? null
	};
}
