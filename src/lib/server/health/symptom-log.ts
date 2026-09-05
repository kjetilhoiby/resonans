/**
 * symptom-log.ts — den ENE skrive- og leseveien for symptomer.
 *
 * Reglene bor rent i `$lib/domain/health/symptoms.ts`. Samme form som
 * `sick-log.ts`, og bevisst så likt: en rad per symptom, `dataType: 'symptom'`,
 * på den eksisterende `tilstand_flag`-sensoren — det er den samme rigga.
 *
 * `timestamp` er REGISTRERINGSTIDSPUNKTET, ikke symptomets startdag. Sannheten
 * om hvilke dager symptomet dekker ligger i `data.startDate`/`endDate`.
 *
 * Fram til 5. september 2026 sto startdagen der (kl. 12 UTC), og det var en 500
 * i prod: `sensor_events_sensor_datatype_timestamp_unique` er unik på
 * (sensor_id, data_type, timestamp), så et dagsstempel gjør indeksen til en
 * regel om ETT symptom per dag på tilstand-sensoren. Og flere symptomer samme
 * dag er ikke kanten — det er normalen: «vondt i halsen» og «slimhoste» starter
 * i samme døgn. Symptom nummer to feilet med duplikatnøkkel, altså en 500 der
 * flaten bare kunne si «prøv igjen i morgen».
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

/**
 * Samme vindu som sykeperiodene, så et forløp kan leses i sin helhet.
 *
 * Vinduet måles på REGISTRERINGSTIDSPUNKTET, ikke på startdagen. Et symptom
 * registrert i etterkant faller derfor innenfor selv om det startet før vinduet
 * — det motsatte av hva et dagsstempel ga.
 */
export const SYMPTOM_LOOKBACK_DAYS = 400;

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
		// Tidsstempelet flyttes IKKE ved retting. En rettet startdato er ikke en ny
		// registrering — og et stempel som fulgte startdagen ville dessuten kunne
		// flytte raden oppå en annen rads plass i unikhetsindeksen, altså den
		// samme 500-en en gang til, denne gangen ved redigering.
		const updated = await db
			.update(sensorEvents)
			.set({ data })
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
		timestamp: now,
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
