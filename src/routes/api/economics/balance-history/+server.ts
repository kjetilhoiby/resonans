import { json } from '@sveltejs/kit';
import { buildDailyBalances } from '$lib/server/integrations/balance-reconstructor';
import type { RequestHandler } from './$types';

/**
 * GET /api/economics/balance-history?accountId=xxx
 * Returns daily balances anchored to all stored bank_balance snapshots.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const accountId = url.searchParams.get('accountId');
	if (!accountId) return json({ error: 'Missing accountId' }, { status: 400 });

	const days = await buildDailyBalances(locals.userId, accountId);
	return json(days);
};
