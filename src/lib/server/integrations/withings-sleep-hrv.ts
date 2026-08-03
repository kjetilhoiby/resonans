/**
 * Henter HRV (`sdnn_1`) per natt fra Withings og fester det på søvnhendelsen.
 *
 * ## Hvorfor et eget steg
 *
 * HRV ligger **ikke** i `getsummary`, som er der resten av nattas tall kommer fra.
 * Den finnes bare i `action=get`, som gir minutt-for-minutt-serier og må kalles per
 * dato. `backfillSleepHrForDate` har bedt om `sdnn_1` i det kallet siden feltet ble
 * lagt inn, og kastet det — dataen har vært betalt for og sluppet på gulvet.
 *
 * Dette steget eier HRV alene, av samme grunn som HRR har sitt eget: to steder som
 * skriver samme felt blir umulig å resonnere om.
 *
 * Selvhelende og takstyrt på samme måte som `syncHrRecovery` — se den for
 * begrunnelsen. Synken kjører hvert 5. minutt, så netter som alt har HRV hoppes
 * over før noe nettverk røres.
 */

import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { db, pgClient } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { fetchWithingsSleep } from './withings';
import { parseSleepHrvSeries } from '$lib/domain/health/hrv';

/** Hvor langt bakover vi ser etter netter uten HRV. */
export const HRV_LOOKBACK_DAYS = 21;

/** Maks antall Withings-kall per kjøring. Resten tas neste gang. */
export const MAX_FETCHES_PER_RUN = 5;

export interface HrvSyncResult {
	/** Netter som fikk HRV denne kjøringen. */
	stored: number;
	/** Netter uten HRV da vi startet. */
	missing: number;
	/** Netter vi hentet, men der enheten ikke leverte SDNN. */
	unavailable: number;
	fetches: number;
	/** Netter som ble utsatt av taket. */
	deferred: number;
}

export async function syncSleepHrv(
	userId: string,
	accessToken: string,
	opts: { lookbackDays?: number } = {}
): Promise<HrvSyncResult> {
	const lookbackDays = opts.lookbackDays ?? HRV_LOOKBACK_DAYS;
	const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

	// Søvnhendelser uten hrv. `data->'hrv'` er null både når nøkkelen mangler og
	// når den er JSON-null, som er det vi vil: begge betyr «ikke målt ennå».
	const pending = await db
		.select({ id: sensorEvents.id, timestamp: sensorEvents.timestamp })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'sleep'),
				gte(sensorEvents.timestamp, since),
				isNull(sql`${sensorEvents.data} -> 'hrv'`)
			)
		);

	const result: HrvSyncResult = {
		stored: 0,
		missing: pending.length,
		unavailable: 0,
		fetches: 0,
		deferred: 0
	};
	if (pending.length === 0) return result;

	// Én natt kan ligge som flere segmenter, og alle deler samme dato-kall.
	const byDate = new Map<string, string[]>();
	for (const row of pending) {
		const date = row.timestamp.toISOString().slice(0, 10);
		const bucket = byDate.get(date);
		if (bucket) bucket.push(row.id);
		else byDate.set(date, [row.id]);
	}

	// Nyeste natt først — den er mest interessant, og taket skal ramme de eldste.
	const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
	const toFetch = dates.slice(0, MAX_FETCHES_PER_RUN);
	result.deferred = byDate.size - toFetch.length;
	if (result.deferred > 0) {
		console.log(
			`   [hrv] ${byDate.size} netter å hente, tar ${toFetch.length} nå. ${result.deferred} utsatt til neste kjøring.`
		);
	}

	for (const date of toFetch) {
		const parsed = await fetchNightHrv(accessToken, date);
		result.fetches++;

		if (!parsed) {
			// Enheten leverte ikke SDNN denne natta. Ikke en feil — bare ikke alle
			// Withings-modeller måler det, og en natt uten klokke gir ingenting.
			result.unavailable++;
			continue;
		}

		for (const id of byDate.get(date) ?? []) {
			// Slås inn i eksisterende JSONB, som hr_average-backfillen: å skrive hele
			// data-objektet ville overskrevet felt andre kilder eier.
			await pgClient`
				UPDATE sensor_events
				SET data = data || ${JSON.stringify({ hrv: parsed })}::jsonb
				WHERE id = ${id}
			`;
			result.stored++;
		}
	}

	return result;
}

/** Null når natta ikke har brukbar SDNN. Kaster ikke på Withings-feil. */
async function fetchNightHrv(
	accessToken: string,
	date: string
): Promise<{ sdnnMs: number; samples: number } | null> {
	const response = await fetchWithingsSleep(accessToken, {
		action: 'get',
		startdate: Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000),
		enddate: Math.floor(new Date(`${date}T23:59:59Z`).getTime() / 1000),
		data_fields: 'sdnn_1'
	});

	if (response?.status !== 0) {
		console.warn(
			`   [hrv] Withings avviste get for ${date} (status ${response?.status}${response?.error ? `: ${response.error}` : ''}).`
		);
		return null;
	}

	return parseSleepHrvSeries(response?.body?.series);
}
