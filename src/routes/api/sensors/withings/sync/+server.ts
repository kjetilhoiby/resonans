import { json } from '@sveltejs/kit';
import { syncAllWithingsData } from '$lib/server/integrations/withings-sync';
import { DEFAULT_USER_ID } from '$lib/server/users';
import type { RequestHandler } from './$types';

/**
 * Manually trigger Withings data sync
 * POST /api/sensors/withings/sync
 */
export const POST: RequestHandler = async () => {
	try {
		const userId = DEFAULT_USER_ID;

		const results = await syncAllWithingsData(userId);

		return json({
			success: true,
			synced: results,
			message: `Synced ${results.weight} weight, ${results.activity} activity, ${results.sleep} sleep records`
		});
	} catch (error) {
		console.error('Withings sync error:', error);
		return json(
			{
				error: error instanceof Error ? error.message : 'Sync failed'
			},
			{ status: 500 }
		);
	}
};
