/**
 * medication-log.ts — den ENE skrive- og leseveien for medisiner og doser.
 *
 * Reglene bor rent i `$lib/domain/health/medications.ts`; denne fila gjør bare
 * DB-arbeidet. Samme arbeidsdeling som `sick-log.ts` og `symptom-log.ts`.
 *
 * ## Lagring
 *
 * To datatyper på den eksisterende `tilstand_flag`-sensoren, som sykeperiodene
 * og nivå-innsjekkene:
 *
 *  - `medication` — én rad per KUR.
 *  - `medication_dose` — én rad per DOSE, bare for `ved_behov`.
 *
 * ## Tidsstemplet er REGISTRERINGSTIDSPUNKTET, og på doser er det kritisk
 *
 * `sensor_events_sensor_datatype_timestamp_unique` er unik på
 * (sensor_id, data_type, timestamp). Stempler man en rad med et DØGN, innfører
 * man «én rad per dag per datatype» — en forretningsregel indeksen håndhever
 * med en 500, ikke med en feilmelding flaten kan si noe om. Det felte
 * symptomloggen og sykeperiodene i prod 5. september 2026.
 *
 * **På doser er det verre enn et 500-svar.** Flere doser samme dag er ikke et
 * kantttilfelle her, det er hele poenget: «fire ganger mandag, én gang fredag»
 * er det ene signalet ved-behov-loggen finnes for. Et dagsstempel ville kappet
 * hver dag til én dose — altså gjort tallet galt i nøyaktig den retningen som
 * SKJULER signalet (fire leses som én), og de tre avviste skrivingene ville sett
 * ut som en flate som ikke virker.
 *
 * Dagen bor derfor i `data.day`, aldri i stemplet. Og stemplet flyttes ALDRI ved
 * retting — en rettet dato er ikke en ny registrering.
 *
 * ## Vi tolker ingenting
 *
 * Ingen doseringssjekk, ingen interaksjoner, ingen påminnelser, ingen dom om
 * hvorvidt kuren virket. Se modulkommentaren i domenelaget for hvorfor den siste
 * er en statistisk felle og ikke bare en forsiktighetsregel.
 */

import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents, sensors } from '$lib/db/schema';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { isDayKey } from '$lib/domain/health/sick-periods';
import { localHourMinute } from '$lib/domain/sleep-goals';
import {
	buildMedicationDay,
	describeMedicationDay,
	isClockTime,
	nextDose,
	resolveMedication,
	validateMedication,
	type Medication,
	type MedicationDose,
	type MedicationInput,
	type MedicationRhythm
} from '$lib/domain/health/medications';
import { todayOsloKey } from './sick-log';

export const MEDICATION_DATA_TYPE = 'medication';
export const MEDICATION_DOSE_DATA_TYPE = 'medication_dose';
const TILSTAND_PROVIDER = 'tilstand_flag';

/** Samme vindu som sykeperiodene, målt på registreringstidspunktet. */
export const MEDICATION_LOOKBACK_DAYS = 400;

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

function toMedication(row: { id: string; data: unknown }): Medication | null {
	const data = (row.data ?? {}) as Record<string, unknown>;
	if (!isDayKey(data.startDate)) return null;
	if (typeof data.name !== 'string' || !data.name.trim()) return null;
	const rhythm = data.rhythm === 'ved_behov' ? 'ved_behov' : 'fast';
	return {
		id: row.id,
		name: data.name.trim(),
		purpose: typeof data.purpose === 'string' && data.purpose.trim() ? data.purpose.trim() : null,
		rhythm: rhythm as MedicationRhythm,
		times: Array.isArray(data.times) ? data.times.filter(isClockTime).sort() : [],
		startDate: data.startDate,
		endDate: isDayKey(data.endDate) ? data.endDate : null,
		note: typeof data.note === 'string' && data.note.trim() ? data.note.trim() : null
	};
}

/** Alle registrerte kurer, sist startet først. */
export async function listMedications(
	userId: string,
	opts: { sinceDays?: number } = {}
): Promise<Medication[]> {
	const since = new Date(Date.now() - (opts.sinceDays ?? MEDICATION_LOOKBACK_DAYS) * 86_400_000);
	const rows = await db
		.select({ id: sensorEvents.id, data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, MEDICATION_DATA_TYPE),
				gte(sensorEvents.timestamp, since)
			)
		)
		.orderBy(desc(sensorEvents.timestamp));

	return rows
		.map(toMedication)
		.filter((m): m is Medication => m !== null)
		.sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
}

export type SaveMedicationResult =
	| { ok: true; medication: Medication }
	| { ok: false; error: string };

/**
 * Opprett eller rett en kur. Én skrivevei for flaten, endepunktet og (senere)
 * chatten — validert med den samme rene funksjonen flaten bruker.
 */
export async function saveMedication(
	userId: string,
	input: MedicationInput,
	now: Date = new Date()
): Promise<SaveMedicationResult> {
	const validation = validateMedication(input, todayOsloKey(now));
	if (!validation.ok) return validation;
	const { id, ...fields } = validation.value;
	const data = { ...fields };

	if (id) {
		// Tidsstempelet flyttes IKKE ved retting — se filhodet.
		const updated = await db
			.update(sensorEvents)
			.set({ data })
			.where(
				and(
					eq(sensorEvents.id, id),
					eq(sensorEvents.userId, userId),
					eq(sensorEvents.dataType, MEDICATION_DATA_TYPE)
				)
			)
			.returning({ id: sensorEvents.id });
		if (updated.length === 0) return { ok: false, error: 'Fant ikke medisinen.' };
		return { ok: true, medication: { id, ...fields } };
	}

	const sensor = await getOrCreateTilstandSensor(userId);
	const written = await SensorEventService.write({
		userId,
		sensorId: sensor.id,
		eventType: 'measurement',
		dataType: MEDICATION_DATA_TYPE,
		timestamp: now,
		data,
		source: 'medication_log'
	});
	const eventId = written.event?.id;
	if (!eventId) return { ok: false, error: 'Klarte ikke å lagre medisinen.' };
	return { ok: true, medication: { id: eventId, ...fields } };
}

/**
 * Avslutt en kur: sett sluttdato.
 *
 * Defaulten er I DAG, ikke gårsdagen — motsatt av `endSickPeriod`, og skillet er
 * hva de to gjør. Sykeperioden UNNSKYLDER dager, så én dag for mye koster en
 * streak-dag brukeren kunne holdt. En kur beskriver bare, og «siste dagen jeg
 * tok den» er dagen du tar den siste dosen. Samme regel som et symptom som
 * markeres over.
 */
export async function endMedication(
	userId: string,
	id: string,
	endDate?: string,
	now: Date = new Date()
): Promise<SaveMedicationResult> {
	const meds = await listMedications(userId);
	const med = meds.find((m) => m.id === id);
	if (!med) return { ok: false, error: 'Fant ikke medisinen.' };
	return saveMedication(userId, { ...med, endDate: endDate ?? todayOsloKey(now) }, now);
}

export async function deleteMedication(userId: string, id: string): Promise<boolean> {
	const deleted = await db
		.delete(sensorEvents)
		.where(
			and(
				eq(sensorEvents.id, id),
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, MEDICATION_DATA_TYPE)
			)
		)
		.returning({ id: sensorEvents.id });
	return deleted.length > 0;
}

/* ── Doser ───────────────────────────────────────────────────────────────── */

function toDose(row: { id: string; timestamp: Date; data: unknown }): MedicationDose | null {
	const data = (row.data ?? {}) as Record<string, unknown>;
	if (typeof data.medicationId !== 'string') return null;
	if (!isDayKey(data.day)) return null;
	return {
		id: row.id,
		medicationId: data.medicationId,
		day: data.day,
		takenAt: typeof data.takenAt === 'string' ? data.takenAt : row.timestamp.toISOString(),
		slot: isClockTime(data.slot) ? data.slot : null,
		note: typeof data.note === 'string' && data.note.trim() ? data.note.trim() : null
	};
}

export async function listMedicationDoses(
	userId: string,
	opts: { sinceDays?: number } = {}
): Promise<MedicationDose[]> {
	const since = new Date(Date.now() - (opts.sinceDays ?? MEDICATION_LOOKBACK_DAYS) * 86_400_000);
	const rows = await db
		.select({ id: sensorEvents.id, timestamp: sensorEvents.timestamp, data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, MEDICATION_DOSE_DATA_TYPE),
				gte(sensorEvents.timestamp, since)
			)
		)
		.orderBy(desc(sensorEvents.timestamp));

	return rows.map(toDose).filter((d): d is MedicationDose => d !== null);
}

export type LogDoseResult = { ok: true; dose: MedicationDose } | { ok: false; error: string };

/**
 * Logg én dose.
 *
 * **`slot` sies av kalleren, den utledes aldri av klokka.** «Jeg tok
 * morgendosen først kl. 11» er helt vanlig, og en nærmeste-slot-gjetning ville
 * da fylt formiddagssloten og latt morgenen stå som glemt — altså gjort loggen
 * gal i akkurat det tilfellet den finnes for å fange. Flaten haker av en
 * navngitt slot; en dose uten slot er en ekstradose (og alt for `ved_behov`).
 *
 * Begge rytmer logger doser. Første utgave AVVISTE doser på faste kurer, fordi
 * antallet er gitt av planen — men det er nettopp den kuren som har slots å
 * hake av, og uten dem finnes ingen dosekalender.
 */
export async function logMedicationDose(
	userId: string,
	medicationId: string,
	opts: { day?: string; slot?: string | null; note?: string | null } = {},
	now: Date = new Date()
): Promise<LogDoseResult> {
	const today = todayOsloKey(now);
	const meds = await listMedications(userId);
	const med = meds.find((m) => m.id === medicationId);
	if (!med) return { ok: false, error: 'Fant ikke medisinen.' };

	let slot: string | null = null;
	if (opts.slot != null && opts.slot !== '') {
		if (!isClockTime(opts.slot)) {
			return { ok: false, error: 'Klokkeslett må være på formen TT:MM.' };
		}
		// En slot som ikke finnes i planen ville blitt usynlig i kalenderen — raden
		// hadde stått i basen uten en rad å stå i. Avvises framfor å skrives stille.
		if (!med.times.includes(opts.slot)) {
			return { ok: false, error: `«${med.name}» har ingen dose kl. ${opts.slot}.` };
		}
		slot = opts.slot;
	}

	const day = opts.day ?? today;
	if (!isDayKey(day)) return { ok: false, error: 'Dagen må være på formen ÅÅÅÅ-MM-DD.' };
	// En dose fram i tid er ikke en registrering, og en før kuren startet hører
	// ikke til den — begge ville gitt en tom kolonne et sted som ser ut som data.
	if (day > today) return { ok: false, error: 'Kan ikke logge en dose fram i tid.' };
	if (day < med.startDate) {
		return { ok: false, error: `Kuren startet ${med.startDate} — dosen kan ikke være før den.` };
	}

	const sensor = await getOrCreateTilstandSensor(userId);
	const written = await SensorEventService.write({
		userId,
		sensorId: sensor.id,
		eventType: 'measurement',
		dataType: MEDICATION_DOSE_DATA_TYPE,
		// Registreringstidspunktet. Flere doser samme dag er normalen her — se filhodet.
		timestamp: now,
		data: { medicationId, day, takenAt: now.toISOString(), slot, note: opts.note ?? null },
		source: 'medication_log'
	});
	const eventId = written.event?.id;
	if (!eventId) return { ok: false, error: 'Klarte ikke å lagre dosen.' };
	return {
		ok: true,
		dose: {
			id: eventId,
			medicationId,
			day,
			takenAt: now.toISOString(),
			slot,
			note: opts.note ?? null
		}
	};
}

/** Angre en dose. En feiltrykt dose skal kunne fjernes — tallet er et signal. */
export async function deleteMedicationDose(userId: string, id: string): Promise<boolean> {
	const deleted = await db
		.delete(sensorEvents)
		.where(
			and(
				eq(sensorEvents.id, id),
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, MEDICATION_DOSE_DATA_TYPE)
			)
		)
		.returning({ id: sensorEvents.id });
	return deleted.length > 0;
}

/** Oslo-veggklokka som «HH:MM». Slottene er Oslo-tid, så sammenligningen må være det. */
export function osloHm(now: Date = new Date()): string {
	const { hour, minute } = localHourMinute(now);
	return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Hvor mange dager bakover kalenderen viser.
 *
 * Fjorten er valgt mot en KUR, ikke mot statistikk: en antibiotikakur er 7–10
 * dager, så to uker dekker den forrige også. Lengre historikk finnes i radene;
 * dette er vinduet man ser på.
 */
export const CALENDAR_DAYS = 14;

/** Alt dosekalenderen trenger, ferdig utregnet. */
export async function loadMedications(userId: string, now: Date = new Date()) {
	const today = todayOsloKey(now);
	const hm = osloHm(now);
	const [meds, doses] = await Promise.all([
		listMedications(userId),
		listMedicationDoses(userId)
	]);

	const days: string[] = [];
	for (let i = CALENDAR_DAYS - 1; i >= 0; i--) {
		days.push(new Date(new Date(`${today}T12:00:00Z`).getTime() - i * 86_400_000)
			.toISOString()
			.slice(0, 10));
	}

	return {
		today,
		now: hm,
		days,
		/**
		 * Neste planlagte dose på tvers av kurene. Det er SPØRSMÅLET med to
		 * medisiner på ulik frekvens, og linja flaten leder med.
		 */
		next: nextDose(meds, doses, today, hm),
		medications: meds.map((m) => {
			const resolved = resolveMedication(m, today);
			const today_ = buildMedicationDay(m, doses, today, today, hm);
			return {
				...resolved,
				today: today_,
				todayText: describeMedicationDay(m, today_),
				// Hele vinduet, så kalenderen kan tegnes uten en runde til.
				calendar: days.map((d) => buildMedicationDay(m, doses, d, today, hm))
			};
		})
	};
}
