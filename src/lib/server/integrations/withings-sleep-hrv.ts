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
import { nightFetchWindow } from '$lib/domain/sleep/night-window';
import { nightKeyForTime } from '$lib/domain/sleep/disturbance';

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
				isNull(sql`${sensorEvents.data} -> 'hrv'`),
				/**
				 * Dagsøvner er ikke netter.
				 *
				 * `nightKeyForTime` legger en dupp kl. 14 og natta som endte samme morgen i
				 * *samme* bøtte (kveldsgrensa er 18:00). Uten dette filteret fikk duppen
				 * nattas HRV stemplet på seg — prod 2. august hadde en dupp med
				 * `{sdnnMs: 54, samples: 89}`, bytelikt med natta før. Og siden
				 * `pickHrvMetric` dedupliserer på dato, kunne duppen overskrive nattas
				 * ekte verdi.
				 */
				sql`(${sensorEvents.data} ->> 'isNap') IS DISTINCT FROM 'true'`
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

	/**
	 * Én natt kan ligge som flere segmenter, og alle deler samme kall.
	 *
	 * Gruppert på **nattnøkkelen** (datoen du våkner), ikke på UTC-datoen til
	 * søvnstart. Prod-øktene starter 20:57–22:54 UTC, så en UTC-dato splittet nettene
	 * vilkårlig og lot hvert kall dekke bare den første timen. Se `night-window.ts`.
	 */
	const byNight = new Map<string, { ids: string[]; starts: Date[] }>();
	for (const row of pending) {
		const key = nightKeyForTime(row.timestamp);
		if (!key) continue;
		const bucket = byNight.get(key);
		if (bucket) {
			bucket.ids.push(row.id);
			bucket.starts.push(row.timestamp);
		} else {
			byNight.set(key, { ids: [row.id], starts: [row.timestamp] });
		}
	}

	// Nyeste natt først — den er mest interessant, og taket skal ramme de eldste.
	const nights = [...byNight.keys()].sort((a, b) => b.localeCompare(a));
	const toFetch = nights.slice(0, MAX_FETCHES_PER_RUN);
	result.deferred = byNight.size - toFetch.length;
	if (result.deferred > 0) {
		console.log(
			`   [hrv] ${byNight.size} netter å hente, tar ${toFetch.length} nå. ${result.deferred} utsatt til neste kjøring.`
		);
	}

	for (const night of toFetch) {
		const bucket = byNight.get(night);
		if (!bucket) continue;

		const parsed = await fetchNightHrv(accessToken, night, bucket.starts);
		result.fetches++;

		if (!parsed) {
			// Enheten leverte ikke SDNN denne natta. Ikke en feil — bare ikke alle
			// Withings-modeller måler det, og en natt uten klokke gir ingenting.
			result.unavailable++;
			continue;
		}

		for (const id of bucket.ids) {
			/**
			 * Objektet bygges i SQL, ikke som en JSON-streng i en parameter.
			 *
			 * Forrige utgave gjorde `data || ${JSON.stringify({hrv})}::jsonb`, og den
			 * parameteren nådde basen som en jsonb **streng** framfor et objekt. I
			 * Postgres er `object || string` ikke en fletting — det er en
			 * *konkatenering*, så `data` ble arrayen `[originalObjekt, "{\"hrv\":…}"]`.
			 *
			 * Verre: `data -> 'hrv'` er NULL på en array, så raden ble aldri regnet som
			 * ferdig. Hver synk la på én streng til — prod-rader hadde attende elementer,
			 * og hvert felt i det opprinnelige objektet (`hr_min`, `sleepDuration`) var
			 * utilgjengelig for alle lesere. Det var årsaken til både «ingen sovepuls
			 * målt» og «ingen netter med HRV», og til dupper som viste 0 min.
			 *
			 * `jsonb_build_object` med tallparametere kan ikke dobbeltkodes.
			 * `hr_average`-backfillen har gjort det slik hele tiden og virket.
			 */
			await pgClient`
				UPDATE sensor_events
				SET data = data || jsonb_build_object(
					'hrv',
					jsonb_build_object(
						'sdnnMs', ${parsed.sdnnMs}::numeric,
						'samples', ${parsed.samples}::int
					)
				)
				WHERE id = ${id}
				  AND jsonb_typeof(data) = 'object'
			`;
			result.stored++;
		}
	}

	return result;
}

/**
 * Null når natta ikke har brukbar SDNN. Kaster ikke på Withings-feil.
 *
 * Vinduet bygges fra søvnøktas egne tidspunkter, ikke fra et UTC-kalenderdøgn. Prod
 * starter nettene 20:57–22:54 UTC, så et kalenderdøgn dekket bare den første timen —
 * se `night-window.ts`.
 */
async function fetchNightHrv(
	accessToken: string,
	night: string,
	starts: Date[]
): Promise<{ sdnnMs: number; samples: number } | null> {
	const window = nightFetchWindow(starts);
	if (!window) return null;

	const response = await fetchWithingsSleep(accessToken, {
		action: 'get',
		startdate: window.startdate,
		enddate: window.enddate,
		data_fields: 'sdnn_1'
	});

	if (response?.status !== 0) {
		console.warn(
			`   [hrv] Withings avviste get for natt ${night} (status ${response?.status}${response?.error ? `: ${response.error}` : ''}).`
		);
		return null;
	}

	return parseSleepHrvSeries(response?.body?.series);
}
