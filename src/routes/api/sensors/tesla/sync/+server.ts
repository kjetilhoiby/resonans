import { json, error } from '@sveltejs/kit';
import { syncTeslaForUser } from '$lib/server/integrations/tesla-sync';
import type { RequestHandler } from './$types';

/**
 * Manuell Tesla-synk (henter ett øyeblikksbilde av vehicle_data).
 * POST /api/sensors/tesla/sync
 */
export const POST: RequestHandler = async ({ locals }) => {
	try {
		const result = await syncTeslaForUser(locals.userId);
		return json({ success: true, ...result });
	} catch (err) {
		console.error('Tesla sync error:', err);
		throw error(500, err instanceof Error ? err.message : 'Failed to sync Tesla data');
	}
};
