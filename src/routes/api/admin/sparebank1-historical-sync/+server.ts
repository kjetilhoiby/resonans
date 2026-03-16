import { json } from '@sveltejs/kit';
import { DEFAULT_USER_ID } from '$lib/server/users';
import { syncAllSparebank1Data } from '$lib/server/integrations/sparebank1-sync';
import type { RequestHandler } from './$types';

// Allow up to 5 minutes for historical sync (Vercel Pro)
export const config = { maxDuration: 300 };

/**
 * Historical sync for SpareBank 1 — fetches all transactions from a given date
 * POST /api/admin/sparebank1-historical-sync
 * Body: { fromDate: "2025-01-01" }  (optional, defaults to 2025-01-01)
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json().catch(() => ({}));
		const fromDateStr: string = body.fromDate ?? '2025-01-01';
		const fromDate = new Date(fromDateStr);

		if (isNaN(fromDate.getTime())) {
			return json({ error: `Invalid fromDate: ${fromDateStr}` }, { status: 400 });
		}

		const userId = DEFAULT_USER_ID;
		console.log(`[SB1 historical sync] Starting from ${fromDateStr}...`);

		const synced = await syncAllSparebank1Data(userId, { fromDate });

		console.log(`[SB1 historical sync] Done: ${synced.accounts} accounts, ${synced.balanceEvents} balance events, ${synced.transactionEvents} new transactions`);

		return json({
			success: true,
			fromDate: fromDateStr,
			synced,
			message: `Hentet ${synced.transactionEvents} nye transaksjoner fra ${synced.accounts} kontoer (fra ${fromDateStr})`
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[SB1 historical sync] Error:', message);
		return json({ success: false, error: message }, { status: 500 });
	}
};
