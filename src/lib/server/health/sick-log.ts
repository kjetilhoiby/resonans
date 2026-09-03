/**
 * sick-log.ts — den ENE skrive- og leseveien for sykeperioder.
 *
 * Reglene bor rent i `$lib/domain/health/sick-periods.ts`; denne fila gjør bare
 * DB-arbeidet. Fire innganger deler den: flaten på Helse, endepunktene under
 * `/api/helse/syk`, readiness (`getActiveEgenfrekvensFlags`) og streak-laget.
 * Skriv aldri en andre sti — det var nettopp to sannheter om «er jeg syk» som
 * gjorde den gamle rigga ubrukelig for streaks.
 *
 * ## Lagring
 *
 * Én `sensor_events`-rad per periode, `dataType: 'sick_period'`, på den
 * eksisterende `tilstand_flag`-sensoren. Samme sensor som det gamle nå-flagget,
 * fordi det ER den samme rigga — bare med en datatype som bærer en periode
 * framfor et tidspunkt.
 *
 * `timestamp` settes til periodens startdag (kl. 12 UTC, altså trygt innenfor
 * Oslo-døgnet uansett sommertid), så radene sorterer kronologisk og `since`-filtre
 * virker. Sannheten om hvilke dager perioden dekker ligger likevel i
 * `data.startDate`/`data.endDate` — aldri i tidsstempelet, som er et
 * registreringstidspunkt og ikke en sykedag.
 *
 * ## Bakoverkompatibilitet
 *
 * Det gamle nå-flagget (`sickUntil` på `tilstand_flag` og på
 * `egenfrekvens_checkin`) leses fortsatt, men BARE som «er jeg syk nå» — det er
 * det eneste spørsmålet det kan svare presist på. Vi rekonstruerer ikke historikk
 * fra det: en periode utledet av når brukeren tilfeldigvis trykket på en knapp
 * ville sett ut som data uten å være det.
 */

import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents, sensors } from '$lib/db/schema';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { osloDayKey } from '$lib/domain/oslo-time';
import {
	activeSickPeriod,
	isDayKey,
	resolveSickPeriod,
	sickDayKeys,
	validateSickPeriod,
	type ResolvedSickPeriod,
	type SickPeriod,
	type SickPeriodInput
} from '$lib/domain/health/sick-periods';

export const SICK_PERIOD_DATA_TYPE = 'sick_period';
const TILSTAND_PROVIDER = 'tilstand_flag';

/** Hvor langt tilbake sykeperioder leses for streak-laget. Samme vindu som streaks. */
export const SICK_LOOKBACK_DAYS = 400;

export function todayOsloKey(now: Date = new Date()): string {
	return osloDayKey(now);
}

/** Midt på dagen UTC — innenfor Oslo-døgnet både sommer og vinter. */
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

function toPeriod(row: { id: string; data: unknown }): SickPeriod | null {
	const data = (row.data ?? {}) as Record<string, unknown>;
	if (!isDayKey(data.startDate)) return null;
	return {
		id: row.id,
		startDate: data.startDate,
		endDate: isDayKey(data.endDate) ? data.endDate : null,
		note: typeof data.note === 'string' && data.note.trim() ? data.note.trim() : null
	};
}

/** Alle registrerte sykeperioder, nyeste først. */
export async function listSickPeriods(
	userId: string,
	opts: { sinceDays?: number } = {}
): Promise<SickPeriod[]> {
	const since = new Date(Date.now() - (opts.sinceDays ?? SICK_LOOKBACK_DAYS) * 86_400_000);
	const rows = await db
		.select({ id: sensorEvents.id, data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, SICK_PERIOD_DATA_TYPE),
				gte(sensorEvents.timestamp, since)
			)
		)
		.orderBy(desc(sensorEvents.timestamp));

	return rows
		.map(toPeriod)
		.filter((p): p is SickPeriod => p !== null)
		.sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
}

export type SaveSickPeriodResult =
	| { ok: true; period: SickPeriod }
	| { ok: false; error: string };

/**
 * Opprett eller rett en sykeperiode. Én skrivevei for flaten, endepunktet og
 * (senere) chatten — validert med den samme rene funksjonen flaten bruker, så en
 * verdi som godtas ett sted ikke avvises et annet.
 */
export async function saveSickPeriod(
	userId: string,
	input: SickPeriodInput,
	now: Date = new Date()
): Promise<SaveSickPeriodResult> {
	const validation = validateSickPeriod(input, todayOsloKey(now));
	if (!validation.ok) return validation;
	const { id, startDate, endDate, note } = validation.value;

	const data = { startDate, endDate, note };

	if (id) {
		const updated = await db
			.update(sensorEvents)
			.set({ data, timestamp: timestampForDay(startDate) })
			.where(
				and(
					eq(sensorEvents.id, id),
					eq(sensorEvents.userId, userId),
					eq(sensorEvents.dataType, SICK_PERIOD_DATA_TYPE)
				)
			)
			.returning({ id: sensorEvents.id });
		if (updated.length === 0) return { ok: false, error: 'Fant ikke sykeperioden.' };
		return { ok: true, period: { id, startDate, endDate, note } };
	}

	const sensor = await getOrCreateTilstandSensor(userId);
	const written = await SensorEventService.write({
		userId,
		sensorId: sensor.id,
		eventType: 'measurement',
		dataType: SICK_PERIOD_DATA_TYPE,
		timestamp: timestampForDay(startDate),
		data,
		source: 'sick_log'
	});
	const eventId = written.event?.id;
	if (!eventId) return { ok: false, error: 'Klarte ikke å lagre sykeperioden.' };
	return { ok: true, period: { id: eventId, startDate, endDate, note } };
}

/**
 * Friskmeld: sett sluttdato på den åpne perioden.
 *
 * Defaulten er GÅRSDAGEN, ikke i dag. «Jeg er frisk» sies om dagen man våkner
 * uten feber, og den dagen er da ikke lenger en sykedag — hadde vi satt i dag,
 * ville en streak-dag brukeren faktisk kunne holdt blitt unnskyldt. Er perioden
 * ett døgn gammel, kan sluttdatoen ikke gå før starten, og da blir det startdagen.
 */
export async function endSickPeriod(
	userId: string,
	id: string,
	endDate?: string,
	now: Date = new Date()
): Promise<SaveSickPeriodResult> {
	const periods = await listSickPeriods(userId);
	const period = periods.find((p) => p.id === id);
	if (!period) return { ok: false, error: 'Fant ikke sykeperioden.' };

	const today = todayOsloKey(now);
	const yesterday = new Date(new Date(`${today}T12:00:00Z`).getTime() - 86_400_000)
		.toISOString()
		.slice(0, 10);
	const resolved = endDate ?? (yesterday < period.startDate ? period.startDate : yesterday);

	return saveSickPeriod(userId, { ...period, endDate: resolved }, now);
}

export async function deleteSickPeriod(userId: string, id: string): Promise<boolean> {
	const deleted = await db
		.delete(sensorEvents)
		.where(
			and(
				eq(sensorEvents.id, id),
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, SICK_PERIOD_DATA_TYPE)
			)
		)
		.returning({ id: sensorEvents.id });
	return deleted.length > 0;
}

/* ── Lesing ──────────────────────────────────────────────────────────────── */

export interface SickState {
	active: boolean;
	/** Første sykedag i den aktive perioden. */
	from: string | null;
	/** Siste sykedag, eller null for «inntil videre». */
	until: string | null;
	/** Den aktive perioden, med alt utregnet. */
	period: ResolvedSickPeriod | null;
	/**
	 * En åpen periode som passerte taket uten sluttdato. Da unnskylder den ikke
	 * lenger, og flaten skal si fra framfor å la brukeren tro at den virker.
	 */
	staleOpen: ResolvedSickPeriod | null;
}

const NOT_SICK: SickState = { active: false, from: null, until: null, period: null, staleOpen: null };

/**
 * «Er jeg syk nå?» — det eneste spørsmålet readiness stiller.
 *
 * Leser periodene først. Finner den ingen aktiv, faller den tilbake på det gamle
 * nå-flagget, så en `sickUntil` satt før september 2026 (eller gjennom en
 * egenfrekvens-checkin) fortsatt slår ut. Fallbacken lager ingen periode: den
 * unnskylder derfor ingen streak-dager, og det er med vilje — vi vet ikke hvilke
 * dager flagget dekket.
 */
export async function getSickState(userId: string, now: Date = new Date()): Promise<SickState> {
	const today = todayOsloKey(now);
	const periods = await listSickPeriods(userId);

	const active = activeSickPeriod(periods, today);
	if (active) {
		return {
			active: true,
			from: active.startDate,
			until: active.endDate,
			period: active,
			staleOpen: null
		};
	}

	const stale =
		periods.map((p) => resolveSickPeriod(p, today)).find((p) => p.staleOpen) ?? null;

	const legacy = await readLegacySickFlag(userId, today);
	if (legacy) {
		return { active: true, from: null, until: legacy, period: null, staleOpen: stale };
	}

	return { ...NOT_SICK, staleOpen: stale };
}

/**
 * Det gamle nå-flagget: nyeste `tilstand_flag` eller `egenfrekvens_checkin` med
 * en `sickUntil` som ikke er passert. Returnerer datoen, ikke en periode.
 */
async function readLegacySickFlag(userId: string, today: string): Promise<string | null> {
	const rows = await db
		.select({ data: sensorEvents.data, timestamp: sensorEvents.timestamp, dataType: sensorEvents.dataType })
		.from(sensorEvents)
		.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'tilstand_flag')))
		.orderBy(desc(sensorEvents.timestamp))
		.limit(1);

	const checkins = await db
		.select({ data: sensorEvents.data, timestamp: sensorEvents.timestamp, dataType: sensorEvents.dataType })
		.from(sensorEvents)
		.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'egenfrekvens_checkin')))
		.orderBy(desc(sensorEvents.timestamp))
		.limit(1);

	// Nyeste av de to vinner: et dedikert flagg satt etter en check-in overstyrer
	// den, og omvendt. Samme regel som den gamle `getActiveEgenfrekvensFlags`.
	const newest = [...rows, ...checkins].sort(
		(a, b) => b.timestamp.getTime() - a.timestamp.getTime()
	)[0];
	if (!newest) return null;

	const sickUntil = (newest.data as Record<string, unknown> | null)?.sickUntil;
	if (typeof sickUntil !== 'string' || sickUntil < today) return null;
	return sickUntil;
}

/**
 * Unnskyldte dagsnøkler for streak-laget.
 *
 * Kallstedet oppgir vinduet det regner i, så vi ikke bygger et Set over 400 dager
 * når kalenderen bare spør om en måned.
 */
export async function loadSickDayKeys(
	userId: string,
	fromKey: string,
	toKey: string,
	now: Date = new Date()
): Promise<string[]> {
	const periods = await listSickPeriods(userId);
	if (periods.length === 0) return [];
	return [...sickDayKeys(periods, fromKey, toKey, todayOsloKey(now))];
}

/* ── Nivået: dårlig → frisk ──────────────────────────────────────────────── */

export const SICK_LEVEL_DATA_TYPE = 'sick_level';

/**
 * Én rad per innsjekk. `timestamp` er dagen målingen gjelder, så to innsjekker
 * samme dag er to rader og den nyeste vinner ved lesing — vi overskriver ikke,
 * fordi «hvordan var det i går kveld» og «hvordan er det nå» begge er sanne.
 */
export async function recordSickLevel(
	userId: string,
	level: number,
	opts: { note?: string | null; day?: string } = {},
	now: Date = new Date()
): Promise<void> {
	const day = opts.day ?? todayOsloKey(now);
	const sensor = await getOrCreateTilstandSensor(userId);
	await SensorEventService.write({
		userId,
		sensorId: sensor.id,
		eventType: 'measurement',
		dataType: SICK_LEVEL_DATA_TYPE,
		timestamp: now,
		data: { day, level, note: opts.note ?? null },
		source: 'sick_checkin_flow'
	});
}

/**
 * Forrige nivåmåling FØR i dag — grunnlaget for den utledede retningen.
 *
 * Dagens egne målinger holdes utenfor med vilje: «ett hakk opp fra i går» skal
 * sammenligne med i går, ikke med svaret man ga to timer siden. Sjekker man inn
 * to ganger på én dag, er den andre en retting, ikke en ny observasjon.
 */
export async function lastSickLevel(
	userId: string,
	now: Date = new Date()
): Promise<{ day: string; level: number } | null> {
	const today = todayOsloKey(now);
	const rows = await db
		.select({ data: sensorEvents.data })
		.from(sensorEvents)
		.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, SICK_LEVEL_DATA_TYPE)))
		.orderBy(desc(sensorEvents.timestamp))
		.limit(20);

	for (const row of rows) {
		const data = (row.data ?? {}) as Record<string, unknown>;
		const day = data.day;
		const level = data.level;
		if (!isDayKey(day) || typeof level !== 'number') continue;
		if (day >= today) continue;
		return { day, level };
	}
	return null;
}
