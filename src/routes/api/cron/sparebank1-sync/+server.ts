import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { DEFAULT_USER_ID } from '$lib/server/users';
import { syncAllSparebank1Data } from '$lib/server/integrations/sparebank1-sync';

// Allow up to 60 seconds for incremental sync
export const config = { maxDuration: 60 };

/**
 * Vercel Cron endpoint — synkroniserer SpareBank 1-data inkrementelt
 * Kjøres automatisk hver 6. time via GitHub Actions (se .github/workflows/cron.yml)
 * GET /api/cron/sparebank1-sync
 */
export const GET: RequestHandler = async ({ request }) => {
	// Verify Vercel Cron secret
	const authHeader = request.headers.get('authorization');
	if (env.VERCEL_ENV && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const userId = DEFAULT_USER_ID;

		// Fetch last 2 days to catch any delayed/corrected transactions
		const fromDate = new Date();
		fromDate.setDate(fromDate.getDate() - 2);

		console.log(`[SB1 cron sync] Starting incremental sync from ${fromDate.toISOString().slice(0, 10)}…`);

		const synced = await syncAllSparebank1Data(userId, { fromDate });

		console.log(
			`[SB1 cron sync] Done: ${synced.accounts} kontoer, ` +
			`${synced.balanceEvents} saldo-events, ` +
			`${synced.transactionEvents} nye transaksjoner`
		);

		return json({
			success: true,
			fromDate: fromDate.toISOString().slice(0, 10),
			synced
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[SB1 cron sync] Error:', message);
		return json({ success: false, error: message }, { status: 500 });
	}
};
