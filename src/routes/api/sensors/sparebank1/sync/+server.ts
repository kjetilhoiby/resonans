import { json } from '@sveltejs/kit';
import { syncAllSparebank1Data } from '$lib/server/integrations/sparebank1-sync';
import type { RequestHandler } from './$types';

/**
 * POST /api/sensors/sparebank1/sync
 * Manually trigger SpareBank1 data synchronization
 * Query params:
 * - fullHistory: if 'true', syncs from 2 years ago instead of last sync date
 */
export const POST: RequestHandler = async ({ url, locals }) => {
	try {
		const userId = locals.userId;
		const fullHistory = url.searchParams.get('fullHistory') === 'true';

		const options = fullHistory
			? {
					fromDate: new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000), // 2 years ago
					includeDebug: true
			  }
			: { includeDebug: true };

		const synced = await syncAllSparebank1Data(userId, options);

		return json({
			success: true,
			synced,
			fullHistory,
			message: fullHistory 
				? `Full historikk: Synkronisert ${synced.accounts} kontoer og ${synced.transactionEvents} transaksjoner`
				: `Synkronisert ${synced.accounts} kontoer og ${synced.transactionEvents} transaksjoner`
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('SpareBank1 sync error:', message);
		return json({ success: false, error: message }, { status: 500 });
	}
};
