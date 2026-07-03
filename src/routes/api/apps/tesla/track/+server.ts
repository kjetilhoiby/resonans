import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadDayTrack } from '$lib/server/integrations/tesla-track';

/**
 * GET /api/apps/tesla/track?date=YYYY-MM-DD   (Bearer rsn_)
 *
 * Dagens posisjons-/ladelogg til Ekko: tidsordnede punkt fra den lagrede
 * Tesla-loggen (cron-samples + Ekkos egne ?live=true-samples), med avledede
 * hendelsesmarkører {park, depart, charge_start, charge_stop, wake}.
 *
 * Kontrakt (avstemt med Ekko, se docs/changelog/2026-07-03-ekko-tesla-etappedata.md):
 * - `date` valgfri, default = i dag i brukerens tidssone.
 * - Ingen data for dagen → `points: []` med HTTP 200 (ikke 404).
 * - `event` er AVLEDET ved diff av påfølgende samples (± sampling-kadens
 *   usikkerhet) — en markør på et eksisterende punkt, ikke en egen rad.
 * - Hull i tidsserien = sovende bil; fylles ikke med interpolerte punkt.
 * - Leser kun lagret logg — vekker aldri bilen.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const dateParam = url.searchParams.get('date');
	const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : undefined;

	try {
		const track = await loadDayTrack(userId, date);
		return json(track);
	} catch (err) {
		console.error('[apps/tesla/track]', err);
		return json({ error: 'Kunne ikke laste dagens spor.' }, { status: 500 });
	}
};
