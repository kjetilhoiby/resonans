import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getStoredTeslaState, syncTeslaForUser } from '$lib/server/integrations/tesla-sync';

/**
 * GET /api/apps/tesla/state  (Bearer rsn_)
 *
 * Forenklet biltilstand til Ekko — proxy mot Tesla slik at Ekko aldri trenger
 * egne Tesla-credentials.
 *
 * Default: ferskeste lagrede data (rask, vekker ikke bilen).
 * `?live=true`: henter et nytt øyeblikksbilde direkte fra Tesla. Dette mater
 * samtidig en eventuell aktiv kjøre-økt (sportType='driving'), så Ekko kan polle
 * dette under en kjøretur for å oppdatere det delte kartet.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const live = url.searchParams.get('live') === 'true';

	if (live) {
		try {
			const r = await syncTeslaForUser(userId);
			return json({ connected: true, source: 'live', asleep: r.asleep, state: r.snapshot });
		} catch (err) {
			return json(
				{ error: err instanceof Error ? err.message : 'Tesla live-fetch feilet' },
				{ status: 502 }
			);
		}
	}

	const stored = await getStoredTeslaState(userId);
	if (!stored.connected) {
		return json({ connected: false, state: null }, { status: 404 });
	}
	return json({ connected: true, source: 'stored', state: stored.state });
};
