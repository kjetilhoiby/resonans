/**
 * DELETE /api/helse/vekt/maalinger/[id]
 *
 * Sletter én vektmåling. For veiinger som målte noe annet enn brukeren — et barn på
 * vekta, en bag, en sensorglipp.
 *
 * Selve slettingen bor i `weight-measurement-store`, delt med chat-verktøyet
 * `manage_weight_measurement`. To veier inn til samme sletting ville drevet fra
 * hverandre.
 *
 * `[id=uuid]` bruker ruteparameter-matcheren: uten den gir et ikke-uuid segment 500
 * fra Postgres der svaret er 404.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	deleteWeightMeasurement,
	SOURCE_CLEANUP_NOTE
} from '$lib/server/health/weight-measurement-store';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const result = await deleteWeightMeasurement(userId, params.id);

		if (!result.ok) {
			return json({ error: result.detail }, { status: result.reason === 'not_found' ? 404 : 409 });
		}

		return json({
			ok: true,
			slettet: result.deleted,
			// Konsekvensen skal sies, ikke oppdages.
			merknad: SOURCE_CLEANUP_NOTE
		});
	} catch (err) {
		console.error('[vekt-maalinger] delete failed:', err);
		return json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
	}
};
