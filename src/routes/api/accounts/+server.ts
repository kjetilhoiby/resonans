import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readLatestBalances } from '$lib/server/economics/transactions';

/**
 * GET /api/accounts
 * Alle bankkontoer for brukeren — id og navn.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const balances = await readLatestBalances(locals.userId);
	return json({ accounts: balances.map((a) => ({ id: a.accountId, name: a.accountName })) });
};
