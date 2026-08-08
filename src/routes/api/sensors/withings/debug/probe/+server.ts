import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getWithingsSensor,
	getValidAccessToken,
	WITHINGS_BODY_MEASTYPES
} from '$lib/server/integrations/withings-sync';
import { fetchWithingsMeasurements } from '$lib/server/integrations/withings';
import { isValidFloor } from '$lib/domain/health/withings-sync-window';

/**
 * GET /api/sensors/withings/debug/probe?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Samme spørsmål som `coverage`, men stilt på seks måter.
 *
 * ## Hvorfor dette finnes
 *
 * `coverage` svarte «0 målinger i 2014, 2015 og 2016» mens Health Mate-appen viser
 * en full trendkurve for nøyaktig den perioden (8. des. 2013 – 7. des. 2017,
 * −11,7 kg, 107,5 kg 1. juli 2014). Én av to påstander er feil, og det kan ikke
 * avgjøres ved å lese vår egen kode: begge sider av uenigheten ligger hos Withings.
 *
 * Endepunktet varierer **én parameter av gangen** mot samme vindu, så et treff
 * peker på hvilken parameter som gjemte dataene. `lastupdate`-varianten er den
 * avgjørende: den spør uten datofilter i det hele tatt, og finner altså den eldste
 * målingen kontoen kjenner til — uavhengig av hva vi tror vi skal be om.
 *
 * ## NB om paginering
 *
 * Datovindu-variantene leser **én side** hver. En side er nok til å svare på
 * «finnes det noe», og `more` sier om det er mer. Variantene uten datofilter
 * paginerer helt ut, fordi Withings sorterer synkende og den eldste målingen
 * dermed ligger på siste side.
 *
 * Leser bare. Skriver ingenting.
 */

type MeasureParams = Parameters<typeof fetchWithingsMeasurements>[1];

interface ProbeResult {
	label: string;
	/** Nøyaktig hva som ble sendt, så et treff kan gjenskapes. */
	params: MeasureParams;
	error?: string;
	count: number;
	/** Sann når Withings sier det finnes flere sider vi ikke leste. */
	more: boolean;
	pages: number;
	earliest: string | null;
	latest: string | null;
	/** Måletyper i svaret, så et treff også sier hva slags måling det var. */
	measureTypes?: Record<string, number>;
}

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

type Group = { date?: number; measures?: Array<{ type?: number }> };

function describe(groups: Group[]) {
	const dates = groups
		.map((g) => (typeof g.date === 'number' ? g.date : null))
		.filter((d): d is number => d !== null)
		.sort((a, b) => a - b);
	const counts: Record<string, number> = {};
	for (const grp of groups) {
		for (const m of grp.measures ?? []) {
			if (typeof m.type !== 'number') continue;
			const label = `${m.type} (${MEASTYPE_NAMES[m.type] ?? 'ukjent'})`;
			counts[label] = (counts[label] ?? 0) + 1;
		}
	}
	return {
		count: groups.length,
		earliest: dates[0] ? new Date(dates[0] * 1000).toISOString().slice(0, 10) : null,
		latest: dates.at(-1) ? new Date(dates.at(-1)! * 1000).toISOString().slice(0, 10) : null,
		measureTypes: Object.keys(counts).length > 0 ? counts : undefined
	};
}

async function probe(
	accessToken: string,
	label: string,
	params: MeasureParams,
	{ paginate }: { paginate: boolean }
): Promise<ProbeResult> {
	const groups: Group[] = [];
	let offset = 0;
	let more = false;
	let pages = 0;

	try {
		do {
			pages++;
			const response = await fetchWithingsMeasurements(accessToken, { ...params, offset });
			if (response.status !== 0) {
				return {
					label,
					params,
					error: `status ${response.status}: ${response.error || 'ukjent feil'}`,
					count: 0,
					more: false,
					pages,
					earliest: null,
					latest: null
				};
			}
			groups.push(...(response.body.measuregrps ?? []));
			more = response.body.more || false;
			offset = response.body.offset || 0;
		} while (paginate && more && pages < 100);
	} catch (err) {
		return {
			label,
			params,
			error: err instanceof Error ? err.message : String(err),
			count: 0,
			more: false,
			pages,
			earliest: null,
			latest: null
		};
	}

	return { label, params, ...describe(groups), more: paginate ? false : more, pages };
}

export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const from = url.searchParams.get('from') ?? '2014-01-01';
	const to = url.searchParams.get('to') ?? '2014-12-31';
	if (!isValidFloor(from) || !isValidFloor(to)) throw error(400, 'from/to må være YYYY-MM-DD');
	if (from > to) throw error(400, 'from må være før to');

	const sensor = await getWithingsSensor(userId);
	if (!sensor) throw error(404, 'Ingen aktiv Withings-sensor');
	const accessToken = await getValidAccessToken(sensor);

	const startdate = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
	const enddate = Math.floor(Date.parse(`${to}T23:59:59Z`) / 1000);

	const variants: Array<{ label: string; params: MeasureParams; paginate: boolean }> = [
		{
			label: 'som synken: meastypes + category=1 + datovindu',
			params: { action: 'getmeas', meastypes: WITHINGS_BODY_MEASTYPES, category: 1, startdate, enddate },
			paginate: false
		},
		{
			label: 'meastype=1 (entall) + category=1 + datovindu',
			params: { action: 'getmeas', meastype: 1, category: 1, startdate, enddate },
			paginate: false
		},
		{
			label: 'meastypes + datovindu, UTEN category',
			params: { action: 'getmeas', meastypes: WITHINGS_BODY_MEASTYPES, startdate, enddate },
			paginate: false
		},
		{
			label: 'category=2 (mål/objectives) + datovindu',
			params: { action: 'getmeas', meastypes: WITHINGS_BODY_MEASTYPES, category: 2, startdate, enddate },
			paginate: false
		},
		{
			// Den avgjørende: ingen datofilter i det hele tatt.
			label: 'lastupdate=0, hele historikken (paginert)',
			params: { action: 'getmeas', meastype: 1, category: 1, lastupdate: 0 },
			paginate: true
		},
		{
			label: 'ingen dato, ingen lastupdate (paginert)',
			params: { action: 'getmeas', meastype: 1, category: 1 },
			paginate: true
		}
	];

	// Sekvensielt, som i coverage: et diagnoseverktøy skal ikke kunne rate-limite
	// den ekte synken ut av drift.
	const results: ProbeResult[] = [];
	for (const variant of variants) {
		results.push(
			await probe(accessToken, variant.label, variant.params, { paginate: variant.paginate })
		);
	}

	return json({
		window: { from, to },
		sensorConnectedAt: sensor.createdAt ?? null,
		results,
		hint:
			'Finner én variant målinger der de andre er tomme, ligger feilen i parameteren som skiller dem. ' +
			'Er ALLE tomme mens appen viser en kurve, ligger de eldre målingene ikke bak dette OAuth-tilsagnet.'
	});
};
