import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getWithingsSensor,
	getValidAccessToken,
	WITHINGS_BODY_MEASTYPES
} from '$lib/server/integrations/withings-sync';
import { fetchAllWithingsData, fetchWithingsSleep } from '$lib/server/integrations/withings';
import { isValidFloor } from '$lib/domain/health/withings-sync-window';

/**
 * GET /api/sensors/withings/debug/coverage?from=YYYY-MM-DD&to=YYYY-MM-DD&types=weight,activity,sleep,workouts
 *
 * Hva Withings FAKTISK returnerer for et vindu — rått, uten parsing og uten skriving.
 *
 * ## Hvorfor dette finnes
 *
 * En backfill av 2017 ga `Vekt: 0 · Aktivitet: 0 · Søvn: 0 · Treninger: 0`, og
 * spørsmålet «er kontoen tom, eller mister vi dataene?» kunne bare besvares ved å lese
 * koden og slutte seg til et svar. Det er en dårlig måte å svare på et faktaspørsmål.
 *
 * Endepunktet skiller de to tilfellene: `raw` er antall rader Withings ga oss, `parsed`
 * er hva som overlevde tolkningen. Er `raw` null, er kontoen tom for perioden. Er `raw`
 * over null mens `parsed` er null, er feilen vår.
 *
 * Leser bare. Skriver ingenting, sletter ingenting.
 */

type CoverageType = 'weight' | 'activity' | 'sleep' | 'workouts';
const ALL_TYPES: CoverageType[] = ['weight', 'activity', 'sleep', 'workouts'];

/** Standard: hele Withings' levetid. Spørsmålet er nesten alltid «finnes det noe?». */
const DEFAULT_FROM = '2009-01-01';

interface TypeCoverage {
	raw: number;
	/** Eldste og nyeste rad Withings ga, som ISO-dato. */
	earliest: string | null;
	latest: string | null;
	/** Rader per kalenderår, så et hull er synlig uten å lese hver rad. */
	byYear: Record<string, number>;
	/**
	 * Hvor mange målinger som inneholder hver Withings-måletype.
	 *
	 * Dette er feltet som skiller «vi mister felt» fra «enheten måler dem ikke».
	 * Uten det ser de to identiske ut fra basen: begge gir vekt uten fett. Bare
	 * typenummer og antall — ingen verdier.
	 */
	measureTypes?: Record<string, number>;
	error?: string;
}

/** Withings' måletyper, med navn så svaret kan leses uten oppslagstabell. */
const MEASTYPE_NAMES: Record<number, string> = {
	1: 'vekt',
	5: 'fettfri masse',
	6: 'fettprosent',
	8: 'fettmasse kg',
	11: 'puls',
	76: 'muskelmasse',
	77: 'hydrering',
	88: 'beinmasse',
	123: 'vo2max'
};

function countMeasureTypes(groups: Array<{ measures?: Array<{ type?: number }> }>): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const grp of groups) {
		for (const m of grp.measures ?? []) {
			if (typeof m.type !== 'number') continue;
			const label = `${m.type} (${MEASTYPE_NAMES[m.type] ?? 'ukjent'})`;
			counts[label] = (counts[label] ?? 0) + 1;
		}
	}
	return counts;
}

function summarize(dates: Array<Date | null>): TypeCoverage {
	const valid = dates.filter((d): d is Date => d instanceof Date && Number.isFinite(d.getTime()));
	const byYear: Record<string, number> = {};
	for (const d of valid) {
		const year = String(d.getUTCFullYear());
		byYear[year] = (byYear[year] ?? 0) + 1;
	}
	const sorted = valid.slice().sort((a, b) => a.getTime() - b.getTime());
	return {
		raw: dates.length,
		earliest: sorted[0]?.toISOString().slice(0, 10) ?? null,
		latest: sorted.at(-1)?.toISOString().slice(0, 10) ?? null,
		byYear
	};
}

export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const from = url.searchParams.get('from') ?? DEFAULT_FROM;
	const to = url.searchParams.get('to') ?? new Date().toISOString().slice(0, 10);
	if (!isValidFloor(from) || !isValidFloor(to)) throw error(400, 'from/to må være YYYY-MM-DD');
	if (from > to) throw error(400, 'from må være før to');

	const requested = (url.searchParams.get('types') ?? 'weight')
		.split(',')
		.map((t) => t.trim())
		.filter((t): t is CoverageType => (ALL_TYPES as string[]).includes(t));
	if (requested.length === 0) throw error(400, `types må være ett av: ${ALL_TYPES.join(', ')}`);

	const sensor = await getWithingsSensor(userId);
	if (!sensor) throw error(404, 'Ingen aktiv Withings-sensor');
	const accessToken = await getValidAccessToken(sensor);

	const fromUnix = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
	const toUnix = Math.floor(Date.parse(`${to}T23:59:59Z`) / 1000);

	const coverage: Partial<Record<CoverageType, TypeCoverage>> = {};

	// Sekvensielt, ikke parallelt: et diagnoseverktøy skal ikke kunne rate-limite
	// den ekte synken ut av drift mens noen feilsøker.
	for (const type of requested) {
		try {
			if (type === 'weight') {
				const rows = await fetchAllWithingsData(accessToken, {
					action: 'getmeas',
					meastypes: WITHINGS_BODY_MEASTYPES,
					category: 1,
					startdate: fromUnix,
					enddate: toUnix
				});
				coverage.weight = {
					...summarize(rows.map((r) => new Date((r.date ?? 0) * 1000))),
					measureTypes: countMeasureTypes(rows)
				};
			} else if (type === 'activity') {
				const rows = await fetchAllWithingsData(accessToken, {
					action: 'getactivity',
					startdateymd: from,
					enddateymd: to
				});
				coverage.activity = summarize(rows.map((r) => new Date(`${r.date}T00:00:00Z`)));
			} else if (type === 'workouts') {
				const rows = await fetchAllWithingsData(accessToken, {
					action: 'getworkouts',
					startdateymd: from,
					enddateymd: to
				});
				coverage.workouts = summarize(rows.map((r) => new Date((r.startdate ?? 0) * 1000)));
			} else {
				// Søvn går mot v2 med sin egen paginering, som i prefetchen.
				const series: Array<{ startdate?: number }> = [];
				let offset = 0;
				let hasMore = true;
				let page = 0;
				while (hasMore && page < 100) {
					page++;
					const response = await fetchWithingsSleep(accessToken, {
						action: 'getsummary',
						startdateymd: from,
						enddateymd: to,
						offset
					});
					if (response.status !== 0) throw new Error(response.error || 'Ukjent feil');
					series.push(...(response.body.series || []));
					hasMore = response.body.more || false;
					offset = response.body.offset || 0;
				}
				coverage.sleep = summarize(series.map((r) => new Date((r.startdate ?? 0) * 1000)));
			}
		} catch (err) {
			// Én type som feiler skal ikke skjule svaret for de andre.
			coverage[type] = {
				raw: 0,
				earliest: null,
				latest: null,
				byYear: {},
				error: err instanceof Error ? err.message : String(err)
			};
		}
	}

	return json({
		window: { from, to },
		sensorConnectedAt: sensor.createdAt ?? null,
		coverage,
		hint:
			'raw = rader Withings ga oss, før tolkning. Er den 0, har kontoen ingenting i perioden. ' +
			'measureTypes skiller «vi mister felt» fra «enheten måler dem ikke».'
	});
};
