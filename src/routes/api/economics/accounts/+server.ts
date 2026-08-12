import { json } from '@sveltejs/kit';
import { readLatestBalances } from '$lib/server/economics/transactions';
import type { RequestHandler } from './$types';

/**
 * GET /api/economics/accounts
 * Kontoer med siste kjente saldo.
 *
 * Hentet alle `bank_balance`-rader noensinne og plukket den ferskeste per konto i JS fram
 * til august 2026. Nå `DISTINCT ON` med et ettårsvindu i den delte leseren.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const balances = await readLatestBalances(locals.userId);

	return json(
		balances.map((row) => ({
			accountId: row.accountId,
			accountName: row.accountName,
			accountType: row.accountType,
			accountNumber: row.accountNumber,
			balance: row.balance,
			availableBalance: row.availableBalance,
			currency: row.currency,
			timestamp: row.observedAt
		}))
	);
};
