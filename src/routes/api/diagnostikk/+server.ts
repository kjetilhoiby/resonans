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
 * - Intet resultatsammendrag, ingen payload. `resultSummary` bærer brukerdata
 *   (SB1-synken legger kontonavn der) og `background_jobs.payload` har
 *   kontoreferanser. Utvelgelsen er en HVITELISTE i
 *   `$lib/domain/diagnostics.ts` og `diagnostics-jobs.ts`, testet — ikke en
 *   sletting her.
 * - Feiltekst bare som FINGERAVTRYKK som standard («samme feil som sist?»).
 *   Redigert tekst krever `DIAGNOSTICS_OPEN_ERRORS=true`: Postgres bygger
 *   verdien inn i meldingen ved constraint-brudd (`Key (email)=(…)`), og
 *   redaktøren er en denylist som fanger kjente former, ikke alle.
 * - Ingen logglinjer. `/api/admin/logs` forblir admin-gatet: ringbufferen tar
 *   imot hva som helst, inkludert `[500]`-linjer med brukerinnhold, og et
 *   åpent API over den kan ikke gjøres trygt ved utvelgelse — det finnes
 *   ingen felt å velge mellom.
 *
 * Jobbrader er derimot MED (type, status, forsøk, tidsstempler, `stuck`).
 * Første utgave ga bare tellinger, og `running: 13` uten å si hvilke eller
 * hvor lenge er en observasjon man ikke kan handle på. Typenavnene er
 * maskinnavn og bærer ingen brukerdata.
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
