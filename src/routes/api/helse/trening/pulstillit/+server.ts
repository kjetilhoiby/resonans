import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadHrTrustReport } from '$lib/server/health/hr-trust';

/**
 * GET /api/helse/trening/pulstillit?sport=running&curves=true
 *
 * Hvilke PERIODER er pulsdata til å stole på?
 *
 * ## Hvorfor endepunktet finnes
 *
 * Brukerens gamle brystbelte var ødelagt i en periode: 130 → 230 på ett sekund,
 * og fast der oppe resten av økta. Vakta i `hr-artefacts.ts` stopper en slik
 * kurve når en økt analyseres, men spørsmålet FØR en arkivimport er et annet —
 * *hvilke år* kan vi ta inn puls fra? Å importere de årene ville lagt en hel
 * epoke av rene kvalitetsminutter inn i grafen som skal svare på om de rolige
 * øktene er rolige.
 *
 * Rent lesende. Skriver ingenting, endrer ingenting.
 *
 * ## To lag, to nevnere
 *
 * Standard er lag 1 alene: `avgHeartRate` og `maxHeartRate` fra
 * `canonical_workouts` over HELE historikken, i én lett spørring. Den finner
 * bare det umulige, og «ingen funn» er derfor ikke «ren» — svaret sier det selv,
 * i `text`.
 *
 * `?curves=true` legger på lag 2: et UTVALG på fem kurver per periode, spredt
 * utover perioden, kjørt gjennom `diagnoseHrSeries`. Det er dyrere (sporene er
 * tunge), og tallene har sin egen nevner: `curvesRejected` skal aldri legges til
 * `suspect`.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const sportFamily = url.searchParams.get('sport') ?? 'running';
	const sampleCurves = url.searchParams.get('curves') === 'true';

	const report = await loadHrTrustReport(userId, { sportFamily, sampleCurves });

	return json({
		ok: true,
		sportFamily,
		...report
	});
};
