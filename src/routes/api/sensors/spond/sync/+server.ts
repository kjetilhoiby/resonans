import { json, error } from '@sveltejs/kit';
import { syncSpondData } from '$lib/server/integrations/spond-sync';
import type { RequestHandler } from './$types';

/**
 * POST /api/sensors/spond/sync
 *
 * Manually trigger a Spond sync for the authenticated user.
 * Fetches events from 1 year ago to 1 year ahead for all groups.
 */
export const POST: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) throw error(401, 'Ikke innlogget');

	try {
		const result = await syncSpondData(userId);
		return json({
			success: true,
			message: `Hentet ${result.events} hendelser fra ${result.groups} grupper.`,
			...result
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('Spond sync error:', err);
		throw error(500, msg);
	}
};
