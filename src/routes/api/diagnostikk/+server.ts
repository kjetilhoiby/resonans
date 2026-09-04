import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveDiagnosticsWindow } from '$lib/domain/diagnostics';
import { loadDiagnostics } from '$lib/server/diagnostics';

/**
 * GET /api/diagnostikk?minutes=60&until=2026-09-03T13:00:00Z
 *
 * ÅPENT driftsvindu: hvilke cron-jobber kjørte, hvor lenge tok de, og står
 * det noe i jobbkøen. Uautentisert med vilje — samme begrunnelse som
 * `clock`-pulsen i `/api/health`: den som feilsøker en boks som ikke svarer,
 * har ofte ikke en hemmelighet for hånden, og et diagnoseverktøy man ikke
 * rekker er ikke et diagnoseverktøy. Se
 * `docs/changelog/2026-09-04-aapen-driftsdiagnose.md`.
 *
 * **Hva den IKKE gir**, og hvorfor grensa går der:
 *
 * - Ingen feiltekst, intet resultatsammendrag. `cron_executions.error` er rå
 *   exception-tekst og `resultSummary` bærer brukerdata (SB1-synken legger
 *   kontonavn der). Utvelgelsen er en HVITELISTE i
 *   `$lib/domain/diagnostics.ts`, testet — ikke en sletting her.
 * - Ingen jobbrader, bare tellinger per status.
 * - Ingen logglinjer. `/api/admin/logs` forblir admin-gatet: ringbufferen tar
 *   imot hva som helst, inkludert `[500]`-linjer med brukerinnhold, og et
 *   åpent API over den kan ikke gjøres trygt ved utvelgelse.
 *
 * Svaret sier altså HVOR man skal se, ikke HVA som sto der. Det er nok til å
 * finne jobben som spiste maskinen; meldingen krever fortsatt legitimasjon.
 */
export const GET: RequestHandler = async ({ url }) => {
	const window = resolveDiagnosticsWindow({
		minutes: url.searchParams.get('minutes'),
		until: url.searchParams.get('until')
	});

	try {
		const result = await loadDiagnostics(window);
		return json({ ...result, timestamp: new Date().toISOString() });
	} catch {
		// Ingen feildetaljer ut av et åpent endepunkt — den som trenger dem
		// finner `[500]`-linja i loggen med samme errorId.
		return json({ status: 'error', timestamp: new Date().toISOString() }, { status: 500 });
	}
};
