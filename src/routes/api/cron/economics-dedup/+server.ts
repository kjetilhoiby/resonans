import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { deactivateBookedDuplicates } from '$lib/server/economics/deactivate-booked-duplicates';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';

export const config = { maxDuration: 120 };

/**
 * GET /api/cron/economics-dedup
 *
 * Deaktiverer samme kjøp bokført to ganger. **Automatisk — brukeren skal ikke ha driftsansvar
 * for at tallene stemmer.**
 *
 * ## Hvorfor den finnes når bøttenøkkelen er rettet
 *
 * `merchantKeyFromDescription` stripper nå valutakode, dato og `TIL:`, så de to variantene av et
 * nytt kjøp havner i samme rad og duplikatet oppstår ikke. Denne jobben har tre andre oppgaver:
 *
 * 1. **Historikken.** Rader skrevet før rettelsen ligger i to bøtter alt. De blir ikke skrevet om
 *    av seg selv — SB1 leverer bare ferske transaksjoner.
 * 2. **Format vi ennå ikke har sett.** Nøkkelen er utledet av en visningsstreng banken formaterer
 *    som den vil. 23. juni 2026 begynte den med valutaprefiks uten forvarsel; neste gang blir det
 *    noe annet, og da er dette nettet som fanger det.
 * 3. **Personnavn-prefikser**, som ingen regel kan strippe («Håvard Wormdal Høiby Bolt» mot
 *    «Bolt»). De rapporteres som `medium` og skrives ikke — men de telles, så de er synlige.
 *
 * ## Hvorfor det er trygt å skrive uten at et menneske ser på
 *
 * Vakten er streng, og strengere enn reservasjonsryddingens: **samme dag, eksakt samme beløp,
 * samme konto, begge bokført, og beskrivelsene må være ULIKE** — én skal være den andre med et
 * prefiks foran. To rader med identisk beskrivelse røres aldri, fordi et gjentatt kjøp ser
 * nøyaktig slik ut (to Ruter-billetter, to butikkturer).
 *
 * `confidence: 'high'` betyr valuta- og datoprefiks, som er mekaniske. Alt annet rapporteres.
 * Og `is_active = false` sletter ingenting, så en feil kan reverseres.
 *
 * ## Hva som IKKE er automatisert, og hvorfor
 *
 * `deactivateSupersededReservations` (reservasjon → bokføring) står fortsatt som en knapp.
 * Den matcher på **beløp og konto uten beskrivelse**, innenfor ±3 dager — så to like
 * Ruter-billetter der den ene ennå er PENDING kan bli paret. Det er en reell falsk positiv, og
 * den skal ikke skje usett. Målt i prod var det dessuten bare ETT slikt par igjen: de 242
 * første var et engangsetterslep.
 *
 * Se `docs/changelog/2026-08-12-livslop-forsvinning.md`.
 */

/**
 * Vinduet jobben rydder i.
 *
 * Bredere enn de 90 dagene målingene er gjort på, fordi jobben kjører daglig og et smalt vindu
 * ville etterlatt et hull hvis den var nede noen dager. Smalere enn all historikk, fordi hver
 * kjøring laster radene i vinduet inn i minnet.
 */
const WINDOW_DAYS = 180;

export const GET: RequestHandler = async ({ request, url }) => {
	const authHeader = request.headers.get('authorization');
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// `?dryRun=1` for verifisering uten å skrive. Standard er å SKRIVE — motsatt av
	// admin-endepunktet, og med vilje: en cron som må bes om å gjøre jobben sin gjør den ikke.
	const dryRun = url.searchParams.get('dryRun') === '1';

	const result = await withCronTracking('/api/cron/economics-dedup', async () => {
		const activeSensors = await db.query.sensors.findMany({
			where: and(eq(sensors.provider, 'sparebank1'), eq(sensors.isActive, true))
		});
		const userIds = [...new Set(activeSensors.map((s) => s.userId))];

		const results: Array<Record<string, unknown>> = [];
		let totalDeactivated = 0;
		let totalNok = 0;
		let totalHeldBack = 0;

		for (const userId of userIds) {
			try {
				const outcome = await deactivateBookedDuplicates(userId, {
					days: WINDOW_DAYS,
					dryRun,
					confidence: 'high'
				});
				totalDeactivated += outcome.deactivated;
				totalNok += outcome.selectedNok;
				// Par utenfor `high` — personnavn-prefikser. De telles så en voksende restpost er
				// synlig i loggen framfor å bare stå i basen.
				totalHeldBack += outcome.pairsFound - outcome.selectedPairs;
				console.log(
					`[economics-dedup] user=${userId} found=${outcome.pairsFound} selected=${outcome.selectedPairs} deactivated=${outcome.deactivated} nok=${outcome.selectedNok} heldBack=${outcome.pairsFound - outcome.selectedPairs}`
				);
				results.push({
					userId,
					success: true,
					pairsFound: outcome.pairsFound,
					selectedPairs: outcome.selectedPairs,
					deactivated: outcome.deactivated,
					nok: outcome.selectedNok,
					heldBack: outcome.pairsFound - outcome.selectedPairs,
					byPrefix: outcome.byPrefix
				});
			} catch (err) {
				// Én brukers feil skal ikke stoppe de andre. Kastet videre ville
				// `withCronTracking` markert hele kjøringen som feilet og skjult dem som gikk bra.
				const message = err instanceof Error ? err.message : String(err);
				console.error(`[economics-dedup] user=${userId} failed: ${message}`);
				results.push({ userId, success: false, error: message });
			}
		}

		const failed = results.filter((r) => !r.success).length;
		return {
			// **`success` er falsk hvis noen bruker feilet.** Ellers ville monitoreringen sett en
			// grønn kjøring der halve jobben ikke ble gjort.
			success: failed === 0,
			dryRun,
			windowDays: WINDOW_DAYS,
			users: userIds.length,
			failed,
			totalDeactivated,
			totalNok,
			totalHeldBack,
			results
		};
	});

	return json(result);
};
