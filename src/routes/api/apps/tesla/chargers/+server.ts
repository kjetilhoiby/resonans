import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getNearbyChargersForUser } from '$lib/server/integrations/tesla-sync';

/**
 * GET /api/apps/tesla/chargers  (Bearer rsn_)
 *
 * Ladere nær bilens nåværende posisjon — superchargere med live stall-
 * tilgjengelighet + destination chargers. Eget lett endepunkt (ikke del av
 * kjøre-poll i /state) fordi tilgjengelighet trengs sjeldnere enn posisjon.
 *
 * Vekker ikke bilen: sover den, svarer vi `{ asleep: true, chargers: null }`.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const r = await getNearbyChargersForUser(userId);
		return json({ connected: true, asleep: r.asleep, chargers: r.chargers });
	} catch (err) {
		return json(
			{ error: err instanceof Error ? err.message : 'Tesla charger-fetch feilet' },
			{ status: 502 }
		);
	}
};
