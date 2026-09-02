/**
 * symptom-log.ts — den ENE skrive- og leseveien for symptomer.
 *
 * Reglene bor rent i `$lib/domain/health/symptoms.ts`. Samme form som
 * `sick-log.ts`, og bevisst så likt: en rad per symptom, `dataType: 'symptom'`,
 * på den eksisterende `tilstand_flag`-sensoren — det er den samme rigga.
 *
 * `timestamp` er symptomets startdag (kl. 12 UTC, trygt innenfor Oslo-døgnet),
 * men sannheten om hvilke dager det dekker ligger i `data.startDate`/`endDate`.
 * Tidsstempelet er et registreringstidspunkt, ikke en symptomdag.
 */

import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents, sensors } from '$lib/db/schema';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { todayOsloKey } from './sick-log';
import {
	isDayKey,
	type SickPeriod
} from '$lib/domain/health/sick-periods';
import {
	SYMPTOM_KINDS,
	SYMPTOM_SEVERITIES,
	validateSymptom,
	type Symptom,
	type SymptomInput,
	type SymptomKind,
	type SymptomSeverity
} from '$lib/domain/health/symptoms';

export const SYMPTOM_DATA_TYPE = 'symptom';
const TILSTAND_PROVIDER = 'tilstand_flag';

/** Samme vindu som sykeperiodene, så et forløp kan leses i sin helhet. */
export const SYMPTOM_LOOKBACK_DAYS = 400;

function timestampForDay(dayKey: string): Date {
	return new Date(`${dayKey}T12:00:00Z`);
}

async function getOrCreateTilstandSensor(userId: string) {
	const existing = await db.query.sensors.findFirst({
		where: and(eq(sensors.userId, userId), eq(sensors.provider, TILSTAND_PROVIDER))
	});
	if (existing) return existing;
	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: TILSTAND_PROVIDER,
			type: 'manual_log',
			subtype: TILSTAND_PROVIDER,
			name: 'Tilstand-flagg',
			isActive: true
		})
		.returning();
	return created;
}

function toSymptom(row: { id: string; data: unknown }): Symptom | null {
	const data = (row.data ?? {}) as Record<string, unknown>;
	const label = typeof data.label === 'string' ? data.label.trim() : '';
	if (!label || !isDayKey(data.startDate)) return null;

	return {
		id: row.id,
		label,
		kind: (SYMPTOM_KINDS as readonly string[]).includes(data.kind as string)
			? (data.kind as SymptomKind)
			: 'annet',
		severity: (SYMPTOM_SEVERITIES as readonly string[]).includes(data.severity as string)
			? (data.severity as SymptomSeverity)
			: 'merkbart',
		startDate: data.startDate,
		endDate: isDayKey(data.endDate) ? data.endDate : null,
		limiting: data.limiting === true,
		note: typeof data.note === 'string' && data.note.trim() ? data.note.trim() : null
	};
}

export async function listSymptoms(
	userId: string,
	opts: { sinceDays?: number } = {}
): Promise<Symptom[]> {
	const since = new Date(Date.now() - (opts.sinceDays ?? SYMPTOM_LOOKBACK_DAYS) * 86_400_000);
	const rows = await db
		.select({ id: sensorEvents.id, data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, SYMPTOM_DATA_TYPE),
				gte(sensorEvents.timestamp, since)
			)
		)
		.orderBy(desc(sensorEvents.timestamp));

	return rows
		.map(toSymptom)
		.filter((s): s is Symptom => s !== null)
		.sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
}

export type SaveSymptomResult = { ok: true; symptom: Symptom } | { ok: false; error: string };

/**
 * Opprett eller rett et symptom. Én skrivevei, validert med den samme rene
 * funksjonen flaten bruker.
 */
export async function saveSymptom(
	userId: string,
	input: SymptomInput,
	now: Date = new Date()
): Promise<SaveSymptomResult> {
	const validation = validateSymptom(input, todayOsloKey(now));
	if (!validation.ok) return validation;
	const { id, ...fields } = validation.value;
	const data = { ...fields };

	if (id) {
		const updated = await db
			.update(sensorEvents)
			.set({ data, timestamp: timestampForDay(fields.startDate) })
			.where(
				and(
					eq(sensorEvents.id, id),
					eq(sensorEvents.userId, userId),
					eq(sensorEvents.dataType, SYMPTOM_DATA_TYPE)
				)
			)
			.returning({ id: sensorEvents.id });
		if (updated.length === 0) return { ok: false, error: 'Fant ikke symptomet.' };
		return { ok: true, symptom: { id, ...fields } };
	}

	const sensor = await getOrCreateTilstandSensor(userId);
	const written = await SensorEventService.write({
		userId,
		sensorId: sensor.id,
		eventType: 'measurement',
		dataType: SYMPTOM_DATA_TYPE,
		timestamp: timestampForDay(fields.startDate),
		data,
		source: 'symptom_log'
	});
	const eventId = written.event?.id;
	if (!eventId) return { ok: false, error: 'Klarte ikke å lagre symptomet.' };
	return { ok: true, symptom: { id: eventId, ...fields } };
}

/**
 * Marker et symptom som over.
 *
 * Defaulten er I DAG, ikke gårsdagen — motsatt av friskmeldingen, og det er med
 * vilje. En sykeperiode UNNSKYLDER dager, så en dag for mye koster en streak-dag
 * brukeren kunne holdt. Et symptom unnskylder ingenting; det beskriver. «Halsen
 * er bra nå» sies om en dag der halsen var vond i morgen, og da er i dag den
 * siste dagen den var det.
 */
export async function endSymptom(
	userId: string,
	id: string,
	endDate?: string,
	now: Date = new Date()
): Promise<SaveSymptomResult> {
	const existing = (await listSymptoms(userId)).find((s) => s.id === id);
	if (!existing) return { ok: false, error: 'Fant ikke symptomet.' };
	return saveSymptom(userId, { ...existing, endDate: endDate ?? todayOsloKey(now) }, now);
}

export async function deleteSymptom(userId: string, id: string): Promise<boolean> {
	const deleted = await db
		.delete(sensorEvents)
		.where(
			and(
				eq(sensorEvents.id, id),
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, SYMPTOM_DATA_TYPE)
			)
		)
		.returning({ id: sensorEvents.id });
	return deleted.length > 0;
}

/**
 * Symptomene som overlapper en sykeperiode — forløpet, ikke bare nå-bildet.
 *
 * Ren utvelgelse på datoer, uten en kobling lagret på radene. En fremmednøkkel
 * fra symptom til periode ville tvunget et valg vi ikke har grunnlag for: kneet
 * som startet under infeksjonen og varer to måneder etter «tilhører» ikke
 * perioden i noen meningsfull forstand.
 */
export function symptomsDuringPeriod(
	symptoms: readonly Symptom[],
	period: Pick<SickPeriod, 'startDate' | 'endDate'>,
	todayKey: string
): Symptom[] {
	const end = period.endDate ?? todayKey;
	return symptoms.filter(
		(s) => s.startDate <= end && (s.endDate === null || s.endDate >= period.startDate)
	);
}
