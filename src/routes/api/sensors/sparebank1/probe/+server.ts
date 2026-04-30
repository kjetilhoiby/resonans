import { json } from '@sveltejs/kit';
import { getSparebank1Sensor, getValidSparebank1AccessToken } from '$lib/server/integrations/sparebank1-sync';
import { fetchSparebank1Accounts, fetchSparebank1Transactions } from '$lib/server/integrations/sparebank1';
import type { RequestHandler } from './$types';

/**
 * GET /api/sensors/sparebank1/probe?accountKey=xxx
 * Fetches transactions without date constraints to probe SpareBank1's response cap.
 * Returns count, oldest/newest transaction date, and rate-limit headers.
 * Use this to understand how many years of history we can fetch in one call.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const sensor = await getSparebank1Sensor(userId);
	if (!sensor) return json({ error: 'Ingen SpareBank1-sensor funnet' }, { status: 404 });

	const accessToken = await getValidSparebank1AccessToken(sensor);
	const rateLimitHeaders: Record<string, string> = {};

	const accountKey = url.searchParams.get('accountKey');

	if (!accountKey) {
		// List available accounts so caller knows which key to use
		const accounts = await fetchSparebank1Accounts(accessToken, rateLimitHeaders);
		return json({
			accounts: accounts.map((a: any) => ({
				key: a.key ?? a.accountKey ?? a.id ?? a.accountId,
				name: a.name ?? a.accountName,
				type: a.type ?? a.accountType
			})),
			rateLimitHeaders
		});
	}

	const txns = await fetchSparebank1Transactions(accessToken, accountKey, undefined, undefined, rateLimitHeaders);

	const dates = txns
		.map((t: any) => t.date ?? t.bookingDate ?? t.transactionDate)
		.filter(Boolean)
		.sort();

	return json({
		accountKey,
		count: txns.length,
		oldestDate: dates[0] ?? null,
		newestDate: dates[dates.length - 1] ?? null,
		rateLimitHeaders,
		likelyCapped: txns.length > 0 && txns.length % 100 === 0
	});
};
