import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-auth';
import { getSparebank1Sensor, getValidSparebank1AccessToken } from '$lib/server/integrations/sparebank1-sync';
import { fetchSparebank1Accounts, fetchSparebank1Transactions } from '$lib/server/integrations/sparebank1';
import type { RequestHandler } from './$types';

/**
 * Debug endpoint to inspect raw SpareBank 1 API responses
 * GET /api/admin/debug-sparebank1
 */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		await requireAdmin(locals.userId);
		const userId = locals.userId;
		const sensor = await getSparebank1Sensor(userId);

		if (!sensor) {
			return json({ error: 'No SpareBank1 sensor found' }, { status: 404 });
		}

		const accessToken = await getValidSparebank1AccessToken(sensor);

		const accounts = await fetchSparebank1Accounts(accessToken);
		const firstAccount = accounts[0] ?? null;

		// Try transactions with the first account's key fields
		let transactions: any[] = [];
		let transactionsSample: any = null;
		let accountKeyUsed: string | null = null;

		if (firstAccount) {
			// The account key field is "key" in SB1 API
			accountKeyUsed =
				firstAccount.key ??
				firstAccount.accountKey ??
				firstAccount.id ??
				firstAccount.accountId ??
				firstAccount.number ??
				null;

			if (accountKeyUsed) {
				transactions = await fetchSparebank1Transactions(accessToken, String(accountKeyUsed));
				transactionsSample = transactions[0] ?? null;
			}
		}

		return json({
			accountCount: accounts.length,
			firstAccount,
			accountKeyUsed,
			transactionCount: transactions.length,
			firstTransaction: transactionsSample
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 500 });
	}
};
