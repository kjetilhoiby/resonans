import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { getWithingsSensor, getValidAccessToken } from '$lib/server/integrations/withings-sync';
import { fetchWithingsSleep } from '$lib/server/integrations/withings';
import { nightFetchWindow } from '$lib/domain/sleep/night-window';
import { nightKeyForTime } from '$lib/domain/sleep/disturbance';
import { parseSleepHrvSeries } from '$lib/domain/health/hrv';

/**
 * GET /api/sensors/withings/debug/hrv?nights=5
 *
 * «Hvorfor har HRV aldri produsert data?» — spurt av Withings, ikke av koden vår.
 *
 * ## Hvorfor dette finnes
 *
 * CLAUDE.md har siden 4. august sagt at HRV **aldri** har produsert data i prod
 * (15 netter søvn, 0 med HRV) og at årsaken ikke er funnet. Health Mate viser
 * samtidig en HRV-kurve. Én av to påstander er feil, og begge sider av uenigheten
 * ligger hos Withings — nøyaktig samme situasjon som `debug/probe` ble bygget for.
 *
 * `syncSleepHrv` rapporterer bare `unavailable++` når natta ikke ga SDNN, og det
 * er en observasjon man ikke kan handle på: «enheten leverte ikke» og «vi ba om
 * feil felt» ser identiske ut derfra.
 *
 * ## Hva den svarer på
 *
 * 1. **Hvilke NØKLER kom faktisk tilbake** per segment. Det er hovedpoenget: et
 *    svar som sier «segmentene inneholder hr, rr, snoring — ingen sdnn_1, ingen
 *    rmssd» avgjør saken, mens «0 sdnn_1-verdier» bare gjentar spørsmålet.
 *    Dokumentasjonssida er ikke wire-formatet — se Gemini-avsnittet i CLAUDE.md.
 * 2. **Hvilken ENHET registrerte natta** (`model` fra `getsummary`). `sdnn_1` og
 *    `rmssd` er ikke nødvendigvis tilgjengelige for alle Withings-modeller, og
 *    hvilken som skrev natta er ikke synlig noe sted i vår egen base.
 * 3. **Hva vi selv har lagret** for de samme nettene, så «synken skrev aldri» kan
 *    skilles fra «synken skrev, og leseren finner det ikke».
 *
 * ## Variantene
 *
 * Den FØRSTE er byte-identisk med det `syncSleepHrv` sender — samme vindu fra
 * `nightFetchWindow`, samme `data_fields`. Uten den ville et treff i en av de
 * andre vært et utsagn om vinduet framfor om feltet, og vi hadde flyttet
 * spørsmålet i stedet for å svare på det. Resten varierer ETT felt av gangen.
 *
 * Leser bare. Skriver ingenting.
 */

/** Nok til å se et mønster, lavt nok til å ikke tømme Withings' ratelimit. */
const DEFAULT_NIGHTS = 5;
const MAX_NIGHTS = 14;

/** Hvor langt bakover vi leter etter netter. Samme vindu som synken. */
const LOOKBACK_DAYS = 21;

interface FieldProbe {
	label: string;
	dataFields: string;
	status: number | null;
	error?: string;
	segments: number;
	/** Nøklene Withings faktisk sendte, med antall segmenter de sto i. */
	keys: Record<string, number>;
	/** Hvor mange punkter hver HRV-nøkkel bar, hvis den kom. */
	values: Record<string, number>;
	/** Hva `parseSleepHrvSeries` gjør ut av svaret — altså det synken ville lagret. */
	parsed: { sdnnMs: number; samples: number } | null;
}

interface NightProbe {
	night: string;
	/** Vinduet, som unix-sekunder og lesbart, så et treff kan gjenskapes. */
	window: { startdate: number; enddate: number; from: string; to: string } | null;
	segmentsInDb: number;
	/** Det vi har lagret fra før. Null betyr «synken har aldri skrevet noe». */
	storedHrv: unknown;
	/** Enheten som registrerte natta, fra getsummary. */
	devices: string[];
	probes: FieldProbe[];
}

/** Nøkler vi ikke trenger å telle — de er alltid der og sier ingenting. */
const STRUCTURAL_KEYS = new Set(['startdate', 'enddate', 'state', 'model', 'model_id', 'id']);

function summarizeSegments(series: unknown): Pick<FieldProbe, 'segments' | 'keys' | 'values'> {
	if (!Array.isArray(series)) return { segments: 0, keys: {}, values: {} };

	const keys: Record<string, number> = {};
	const values: Record<string, number> = {};
	for (const segment of series) {
		if (!segment || typeof segment !== 'object') continue;
		for (const [key, value] of Object.entries(segment as Record<string, unknown>)) {
			if (STRUCTURAL_KEYS.has(key)) continue;
			keys[key] = (keys[key] ?? 0) + 1;
			// Seriefeltene er objekter nøklet på unix-tidsstempel. Antall punkter er
			// forskjellen på «feltet finnes» og «feltet har innhold» — en tom serie
			// er nettopp tilstanden som ser ut som «enheten måler ikke».
			if (value && typeof value === 'object') {
				values[key] = (values[key] ?? 0) + Object.keys(value as object).length;
			}
		}
	}
	return { segments: series.length, keys, values };
}

export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const requested = Number(url.searchParams.get('nights') ?? DEFAULT_NIGHTS);
	const nightCount = Number.isFinite(requested)
		? Math.min(Math.max(1, Math.trunc(requested)), MAX_NIGHTS)
		: DEFAULT_NIGHTS;

	const sensor = await getWithingsSensor(userId);
	if (!sensor) throw error(404, 'Ingen aktiv Withings-sensor');
	const accessToken = await getValidAccessToken(sensor);

	const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
	const rows = await db
		.select({
			timestamp: sensorEvents.timestamp,
			data: sensorEvents.data
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'sleep'),
				gte(sensorEvents.timestamp, since)
			)
		)
		.orderBy(desc(sensorEvents.timestamp));

	// Grupper på nattnøkkelen, som synken gjør — ikke på UTC-datoen. Dupper holdes
	// utenfor av samme grunn som der: de deler bøtte med natta før.
	const byNight = new Map<string, { starts: Date[]; stored: unknown[] }>();
	for (const row of rows) {
		const data = (row.data ?? {}) as Record<string, unknown>;
		if (data.isNap === true) continue;
		const key = nightKeyForTime(row.timestamp);
		if (!key) continue;
		const bucket = byNight.get(key) ?? { starts: [], stored: [] };
		bucket.starts.push(row.timestamp);
		bucket.stored.push(data.hrv ?? null);
		byNight.set(key, bucket);
	}

	const nights = [...byNight.keys()].sort((a, b) => b.localeCompare(a)).slice(0, nightCount);

	const results: NightProbe[] = [];
	for (const night of nights) {
		const bucket = byNight.get(night)!;
		const window = nightFetchWindow(bucket.starts);

		const probe: NightProbe = {
			night,
			window: window
				? {
						...window,
						from: new Date(window.startdate * 1000).toISOString(),
						to: new Date(window.enddate * 1000).toISOString()
					}
				: null,
			segmentsInDb: bucket.starts.length,
			storedHrv: bucket.stored.find((h) => h != null) ?? null,
			devices: [],
			probes: []
		};

		if (window) {
			// Hvilken enhet registrerte natta? `sdnn_1` er ikke nødvendigvis
			// tilgjengelig for alle modeller, og modellen finnes ikke i vår base.
			try {
				const summary = await fetchWithingsSleep(accessToken, {
					action: 'getsummary',
					startdate: window.startdate,
					enddate: window.enddate
				});
				const series = (summary?.body as { series?: unknown[] } | undefined)?.series ?? [];
				const models = new Set<string>();
				for (const item of series) {
					const s = item as Record<string, unknown>;
					const model = s.model ?? s.model_id;
					if (model !== undefined) models.add(String(model));
				}
				probe.devices = [...models];
			} catch {
				// Enhetsnavnet er en bonus, ikke svaret. Feiler det, står resten.
			}

			const variants: { label: string; dataFields: string }[] = [
				// MÅ stå først og være identisk med synken — se modulkommentaren.
				{ label: 'som syncSleepHrv: sdnn_1', dataFields: 'sdnn_1' },
				{ label: 'rmssd i stedet', dataFields: 'rmssd' },
				{ label: 'begge HRV-feltene', dataFields: 'sdnn_1,rmssd' },
				// Kontrollen: `hr` VET vi kommer tilbake (hr_average-backfillen
				// bruker den). Kommer hr men ikke sdnn_1 i samme kall, er det feltet
				// som mangler — ikke vinduet, tokenet eller natta.
				{ label: 'kontroll: hr sammen med HRV-feltene', dataFields: 'hr,sdnn_1,rmssd' }
			];

			for (const variant of variants) {
				try {
					const response = await fetchWithingsSleep(accessToken, {
						action: 'get',
						startdate: window.startdate,
						enddate: window.enddate,
						data_fields: variant.dataFields
					});
					const series = (response?.body as { series?: unknown[] } | undefined)?.series;
					probe.probes.push({
						label: variant.label,
						dataFields: variant.dataFields,
						status: response?.status ?? null,
						error: response?.error,
						...summarizeSegments(series),
						parsed: parseSleepHrvSeries(series)
					});
				} catch (err) {
					probe.probes.push({
						label: variant.label,
						dataFields: variant.dataFields,
						status: null,
						error: err instanceof Error ? err.message : String(err),
						segments: 0,
						keys: {},
						values: {},
						parsed: null
					});
				}
			}
		}

		results.push(probe);
	}

	return json({
		nightsFound: byNight.size,
		nightsProbed: results.length,
		/**
		 * Lesenøkkelen står i svaret, ikke bare i koden: den som åpner dette har
		 * som regel ikke lest modulkommentaren.
		 */
		hint:
			'Se på `keys` per variant. Kommer `hr` tilbake mens `sdnn_1`/`rmssd` er fraværende, ' +
			'leverer ikke enheten HRV i action=get — og da er ikke synken feil, den er blind. ' +
			'Kommer `rmssd` men ikke `sdnn_1`, ber vi om feil felt. Er `values` 0 mens nøkkelen ' +
			'finnes, er serien tom for natta.',
		nights: results
	});
};
