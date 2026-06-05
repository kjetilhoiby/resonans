import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { disconnect } from '$lib/server/services/strava-sync-service';

/**
 * Kobler fra Strava. Bearer-autentisert. Deauthorize (best effort) + sletter
 * lagrede tokens for brukeren.
 */
export const DELETE: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	await disconnect(userId);
	return json({ connected: false });
};
