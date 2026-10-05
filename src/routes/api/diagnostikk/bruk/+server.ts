import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveUsageWindow } from '$lib/domain/usage-public';
import { loadPublicUsage } from '$lib/server/usage-diagnostics';

/**
 * GET /api/diagnostikk/bruk?days=30
 *
 * ÅPEN bruksstatistikk: hvilke flater brukes, når (Oslo-tid), hvor lenge, hva
 * trykkes det på, og hvor mye chattes det. Uautentisert med vilje — en
 * Claude-økt uten legitimasjon skal kunne lese bruksmønsteret som grunnlag for
 * en UX-redesign. Se `docs/changelog/2026-10-05-aapen-bruksdiagnose.md`.
 *
 * Står i `PUBLIC_API_EXACT` for seg selv: `/api/diagnostikk` er eksakt match,
 * så denne ruta er ikke åpen fordi forelderen er det.
 *
 * **Hva den IKKE gir:** userId, rå stier, temanavn eller -id-er, metadata,
 * knappetekst, meldingsinnhold. Utvelgelsen er en HVITELISTE i
 * `$lib/domain/usage-public.ts`, testet — ikke en sletting her.
 */
export const GET: RequestHandler = async ({ url }) => {
	const window = resolveUsageWindow(url.searchParams.get('days'));

	try {
		const usage = await loadPublicUsage(window);
		return json({ ...usage, timestamp: new Date().toISOString() });
	} catch (err) {
		// Ingen feildetaljer ut av et åpent endepunkt — loggen har dem.
		console.error('[diagnostikk/bruk] feilet:', err);
		return json({ status: 'error', timestamp: new Date().toISOString() }, { status: 500 });
	}
};
