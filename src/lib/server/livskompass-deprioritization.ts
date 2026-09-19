/**
 * Bevisste nedprioriteringer: lagring og lesing.
 *
 * Én `sensor_events`-rad per periode, `dataType: 'livskompass_deprioritization'`,
 * på livskompassets egen sensor. Ingen ny tabell — samme valg som sykeperiodene
 * og ukesinnsjekkene, og av samme grunn: raden har en eier, en `data`-blob og en
 * id som kan rettes og slettes.
 *
 * **Tidsstempelet er REGISTRERINGSTIDSPUNKTET, aldri startdagen.** Unikhets-
 * indeksen på `sensor_events` er (`sensor_id`, `data_type`, `timestamp`), så et
 * dagsstempel ville innført «én nedprioritering per dag» som en 500 uten
 * feilmelding — nøyaktig fella symptomloggen gikk i. Og stempelet flyttes ikke
 * ved retting: en rettet startdato er ikke en ny registrering.
 *
 * Reglene bor rent i `$lib/domains/livskompass/deprioritization.ts`. Se
 * `docs/changelog/2026-09-19-retningen-som-baerer-prioriteringer.md`.
 */

import { and, desc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { osloDayKey } from '$lib/domain/oslo-time';
import { getOrCreateLivskompassSensor } from '$lib/server/livskompass-sensor';
import {
	resolveDeprioritization,
	validateDeprioritization,
	type Deprioritization,
	type DeprioritizationInput,
	type ResolvedDeprioritization
} from '$lib/domains/livskompass/deprioritization';

export const DEPRIORITIZATION_DATA_TYPE = 'livskompass_deprioritization';

/**
 * Taket er på RADER, ikke på alder: de aktive må alltid være med, og en
 * avsluttet periode er fortsatt historikk noen kan ville se.
 */
const MAX_ROWS = 60;

export type SaveDeprioritizationResult =
	| { ok: true; period: ResolvedDeprioritization }
	| { ok: false; error: string };

function rowToPeriod(row: { id: string; data: unknown }): Deprioritization | null {
	const d = (row.data ?? {}) as Record<string, unknown>;
	if (typeof d.dimensionId !== 'string' || typeof d.startDate !== 'string') return null;
	if (typeof d.endDate !== 'string') return null;
	return {
		id: row.id,
		dimensionId: d.dimensionId,
		startDate: d.startDate,
		endDate: d.endDate,
		reason: typeof d.reason === 'string' ? d.reason : '',
		repair: typeof d.repair === 'string' ? d.repair : null,
		confirmedOn: typeof d.confirmedOn === 'string' ? d.confirmedOn : null,
		settledOn: typeof d.settledOn === 'string' ? d.settledOn : null,
		outcome: d.outcome === 'repaired' || d.outcome === 'drifted' ? d.outcome : null
	};
}

export async function listDeprioritizations(
	userId: string,
	now: Date = new Date()
): Promise<ResolvedDeprioritization[]> {
	const rows = await db
		.select({ id: sensorEvents.id, data: sensorEvents.data })
		.from(sensorEvents)
		.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, DEPRIORITIZATION_DATA_TYPE)))
		.orderBy(desc(sensorEvents.timestamp))
		.limit(MAX_ROWS);

	const todayKey = osloDayKey(now);
	return rows
		.map(rowToPeriod)
		.filter((p): p is Deprioritization => p !== null)
		.map((p) => resolveDeprioritization(p, todayKey));
}

/**
 * Opprett eller rett en nedprioritering.
 *
 * **`data` skrives i sin HELHET**, så en retting må sende alle feltene med på
 * nytt — ellers faller `reason` eller `repair` på gulvet uten at noe sier fra.
 * Samme regel som `confirmedOn` på sykeperiodene og `USER_OWNED_METADATA_KEYS`
 * på øktene. Hjelperne under leser derfor den lagrede raden først.
 */
export async function saveDeprioritization(
	userId: string,
	input: DeprioritizationInput,
	now: Date = new Date()
): Promise<SaveDeprioritizationResult> {
	const todayKey = osloDayKey(now);
	const validation = validateDeprioritization(input, todayKey);
	if (!validation.ok) return validation;
	const { id, ...rest } = validation.value;
	const data = { ...rest };

	if (id) {
		const updated = await db
			.update(sensorEvents)
			.set({ data })
			.where(
				and(
					eq(sensorEvents.id, id),
					eq(sensorEvents.userId, userId),
					eq(sensorEvents.dataType, DEPRIORITIZATION_DATA_TYPE)
				)
			)
			.returning({ id: sensorEvents.id });
		if (updated.length === 0) return { ok: false, error: 'Fant ikke nedprioriteringen.' };
		return { ok: true, period: resolveDeprioritization({ id, ...data }, todayKey) };
	}

	const sensor = await getOrCreateLivskompassSensor(userId);
	const written = await SensorEventService.write({
		userId,
		sensorId: sensor.id,
		eventType: 'measurement',
		dataType: DEPRIORITIZATION_DATA_TYPE,
		timestamp: now,
		data,
		source: 'livskompass_deprioritization'
	});
	const eventId = written.event?.id;
	if (!eventId) return { ok: false, error: 'Klarte ikke å lagre nedprioriteringen.' };
	return { ok: true, period: resolveDeprioritization({ id: eventId, ...data }, todayKey) };
}

/** «Den gjelder fortsatt» — flytt livstegnet til i dag. Rører ellers ingenting. */
export async function confirmDeprioritization(
	userId: string,
	id: string,
	now: Date = new Date()
): Promise<SaveDeprioritizationResult> {
	const existing = (await listDeprioritizations(userId, now)).find((p) => p.id === id);
	if (!existing) return { ok: false, error: 'Fant ikke nedprioriteringen.' };
	return saveDeprioritization(userId, { ...existing, confirmedOn: osloDayKey(now) }, now);
}

/**
 * Forleng terminen.
 *
 * Det tredje utfallet i oppgjøret, og det som må kunne gjentas — men ikke
 * usynlig: en forlengelse setter `confirmedOn` til i dag, så den står som en
 * handling og ikke som fravær av en.
 */
export async function extendDeprioritization(
	userId: string,
	id: string,
	endDate: string,
	now: Date = new Date()
): Promise<SaveDeprioritizationResult> {
	const existing = (await listDeprioritizations(userId, now)).find((p) => p.id === id);
	if (!existing) return { ok: false, error: 'Fant ikke nedprioriteringen.' };
	return saveDeprioritization(
		userId,
		{ ...existing, endDate, confirmedOn: osloDayKey(now) },
		now
	);
}

/**
 * Gjør opp: hentet opp igjen, eller det var drift.
 *
 * «Drift» er det utfallet som gjør de andre troverdige. Uten det kan en
 * forlengelse gjentas i det uendelige og fortsatt kalles et valg.
 */
export async function settleDeprioritization(
	userId: string,
	id: string,
	outcome: 'repaired' | 'drifted',
	now: Date = new Date()
): Promise<SaveDeprioritizationResult> {
	const existing = (await listDeprioritizations(userId, now)).find((p) => p.id === id);
	if (!existing) return { ok: false, error: 'Fant ikke nedprioriteringen.' };
	const todayKey = osloDayKey(now);
	// Validatoren krever en sluttdato fram i tid, og et oppgjør tas som regel
	// ETTER at terminen gikk ut. Skriv derfor direkte — feltene er alt validerte
	// da perioden ble opprettet, og her settes bare utfallet.
	const data = {
		dimensionId: existing.dimensionId,
		startDate: existing.startDate,
		endDate: existing.endDate,
		reason: existing.reason,
		repair: existing.repair,
		confirmedOn: existing.confirmedOn,
		settledOn: todayKey,
		outcome
	};
	const updated = await db
		.update(sensorEvents)
		.set({ data })
		.where(
			and(
				eq(sensorEvents.id, id),
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, DEPRIORITIZATION_DATA_TYPE)
			)
		)
		.returning({ id: sensorEvents.id });
	if (updated.length === 0) return { ok: false, error: 'Fant ikke nedprioriteringen.' };
	return { ok: true, period: resolveDeprioritization({ id, ...data }, todayKey) };
}

export async function deleteDeprioritization(userId: string, id: string): Promise<boolean> {
	const deleted = await db
		.delete(sensorEvents)
		.where(
			and(
				eq(sensorEvents.id, id),
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, DEPRIORITIZATION_DATA_TYPE)
			)
		)
		.returning({ id: sensorEvents.id });
	return deleted.length > 0;
}
