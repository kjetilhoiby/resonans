import { json } from '@sveltejs/kit';
import { DEFAULT_USER_ID } from '$lib/server/users';
import { syncAllSparebank1Data } from '$lib/server/integrations/sparebank1-sync';
import type { RequestHandler } from './$types';

/**
 * POST /api/sensors/sparebank1/sync
 * Manually trigger SpareBank1 data synchronization
 */
export const POST: RequestHandler = async () => {
	try {
		const userId = DEFAULT_USER_ID;
		const synced = await syncAllSparebank1Data(userId);

		return json({
			success: true,
			synced,
			message: `Synkronisert ${synced.accounts} kontoer og ${synced.transactionEvents} transaksjoner`
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('SpareBank1 sync error:', message);
		return json({ success: false, error: message }, { status: 500 });
	}
};
