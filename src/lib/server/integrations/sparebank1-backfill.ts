import { registerBatchHandler } from '$lib/server/batch-runner';
import { getSparebank1Sensor, getValidSparebank1AccessToken, syncAllSparebank1Data } from './sparebank1-sync';
import { fetchSparebank1HelloWorld, fetchSparebank1Accounts, type RateLimitSnapshot } from './sparebank1';

// Fetch sensor + accounts once per batch run, not once per day
let cachedContext: { userId: string; accessToken: string; rateLimitHeaders: RateLimitSnapshot } | null = null;

async function getOrInitContext(userId: string): Promise<{ accessToken: string; rateLimitHeaders: RateLimitSnapshot }> {
	if (cachedContext?.userId === userId) return cachedContext;

	const sensor = await getSparebank1Sensor(userId);
	if (!sensor) throw new Error('Ingen SpareBank1-sensor funnet');

	const accessToken = await getValidSparebank1AccessToken(sensor);
	const rateLimitHeaders: RateLimitSnapshot = {};
	await fetchSparebank1HelloWorld(accessToken, rateLimitHeaders);
	await fetchSparebank1Accounts(accessToken, rateLimitHeaders); // warm up + check limits

	cachedContext = { userId, accessToken, rateLimitHeaders };
	return cachedContext;
}

registerBatchHandler('sparebank1_backfill', {
	async processDay(userId, date) {
		const { rateLimitHeaders } = await getOrInitContext(userId);

		const fromDate = new Date(`${date}T00:00:00Z`);
		const toDate = new Date(`${date}T00:00:00Z`);
		toDate.setUTCDate(toDate.getUTCDate() + 1);

		const result = await syncAllSparebank1Data(userId, {
			fromDate,
			toDate,
			skipExistingDedup: false
		});

		// Merge latest rate limit headers from this day's calls
		Object.assign(rateLimitHeaders, result.rateLimitHeaders);

		return {
			transactionsInserted: result.transactionEvents,
			daysWithTransactions: result.transactionEvents > 0 ? 1 : 0,
			rateLimitHeaders: { ...rateLimitHeaders }
		};
	},
	mergeStats(acc, day) {
		return {
			transactionsInserted: ((acc.transactionsInserted as number) ?? 0) + ((day.transactionsInserted as number) ?? 0),
			daysWithTransactions: ((acc.daysWithTransactions as number) ?? 0) + ((day.daysWithTransactions as number) ?? 0),
			rateLimitHeaders: (day.rateLimitHeaders ?? acc.rateLimitHeaders ?? {})
		};
	},
	initialStats() {
		return { transactionsInserted: 0, daysWithTransactions: 0, rateLimitHeaders: {} };
	}
});
