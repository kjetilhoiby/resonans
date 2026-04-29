import { registerBatchHandler } from '$lib/server/batch-runner';
import { getSparebank1Sensor, getValidSparebank1AccessToken, syncAllSparebank1Data } from './sparebank1-sync';
import { fetchSparebank1HelloWorld, fetchSparebank1Accounts, type RateLimitSnapshot } from './sparebank1';

type BatchContext = {
	userId: string;
	accessToken: string;
	accounts: any[];
	rateLimitHeaders: RateLimitSnapshot;
};

// Cached per batch run — avoids re-fetching accounts + hello world for every day
let cachedContext: BatchContext | null = null;

async function getOrInitContext(userId: string): Promise<BatchContext> {
	if (cachedContext?.userId === userId) return cachedContext;

	const sensor = await getSparebank1Sensor(userId);
	if (!sensor) throw new Error('Ingen SpareBank1-sensor funnet');

	const accessToken = await getValidSparebank1AccessToken(sensor);
	const rateLimitHeaders: RateLimitSnapshot = {};

	await fetchSparebank1HelloWorld(accessToken, rateLimitHeaders);
	const accounts = await fetchSparebank1Accounts(accessToken, rateLimitHeaders);

	cachedContext = { userId, accessToken, accounts, rateLimitHeaders };
	return cachedContext;
}

registerBatchHandler('sparebank1_backfill', {
	async processDay(userId, date) {
		const context = await getOrInitContext(userId);

		const fromDate = new Date(`${date}T00:00:00Z`);
		const toDate = new Date(`${date}T00:00:00Z`);
		toDate.setUTCDate(toDate.getUTCDate() + 1);

		const result = await syncAllSparebank1Data(userId, {
			fromDate,
			toDate,
			skipExistingDedup: false,
			prefetchedAccounts: context
		});

		// Merge latest rate limit headers back into shared context
		Object.assign(context.rateLimitHeaders, result.rateLimitHeaders);

		return {
			transactionsInserted: result.transactionEvents,
			daysWithTransactions: result.transactionEvents > 0 ? 1 : 0,
			rateLimitHeaders: { ...context.rateLimitHeaders }
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
