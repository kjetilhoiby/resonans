import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { canSeeFullHealth } from '$lib/server/health-visibility';
import { runHealthCheck } from '$lib/server/services/monitoring-service';

/**
 * GET /api/health
 *
 * Uautentisert: `status` + `clock`. Med `Authorization: Bearer $CRON_SECRET`:
 * alt, inkludert feiltekst.
 *
 * `?debug` gir INGEN tilgang lenger — den var en forbikjøring av vakten, se
 * `health-visibility.ts`. Parameteren er beholdt som et harmløst alias fordi
 * den står i dokumentasjonen.
 *
 * Trenger du driftsdetaljer uten hemmelighet, er `/api/diagnostikk` stedet:
 * cron-kjøringer med varighet og status, hvitelistet felt for felt.
 */
export const GET: RequestHandler = async ({ request }) => {
	const full = canSeeFullHealth(request.headers.get('authorization'), env.CRON_SECRET);

	try {
		const result = await runHealthCheck();
		if (full) return json(result);
		// `clock` er med i det uautentiserte svaret MED VILJE: vakthunden
		// (.github/workflows/watchdog.yml) har ingen hemmelighet, og pulsen
		// («en cron-kjøring skjedde nylig») lekker ingenting. Monitoreringen
		// selv dispatches av klokka den overvåker, så dette er det ene signalet
		// som må kunne leses utenfra.
		return json({ status: result.status, clock: result.clock, timestamp: result.timestamp });
	} catch {
		return json({ status: 'error', timestamp: new Date().toISOString() }, { status: 500 });
	}
};
