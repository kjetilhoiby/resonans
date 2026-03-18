import { json } from '@sveltejs/kit';
import { DEFAULT_USER_ID } from '$lib/server/users';
import { buildDailyBalances } from '$lib/server/integrations/balance-reconstructor';
import type { RequestHandler } from './$types';

/**
 * GET /api/economics/balance-history?accountId=xxx
 * Returns daily balances anchored to all stored bank_balance snapshots.
 */
export const GET: RequestHandler = async ({ url }) => {
	const accountId = url.searchParams.get('accountId');
	if (!accountId) return json({ error: 'Missing accountId' }, { status: 400 });

	const days = await buildDailyBalances(DEFAULT_USER_ID, accountId);
	return json(days);
};
