import { registerBatchHandler } from '$lib/server/batch-runner';
import { getSparebank1Sensor, getValidSparebank1AccessToken, syncAllSparebank1Data } from './sparebank1-sync';
import {
	fetchSparebank1HelloWorld,
	fetchSparebank1Accounts,
	fetchSparebank1Transactions,
	type RateLimitSnapshot
} from './sparebank1';

const SPARSE_THRESHOLD = 5;

function getAccountKey(account: any): string {
	return String(account.key || account.accountKey || account.id || account.accountId || account.number || '');
}

function computeWaitMs(headers: RateLimitSnapshot): number {
	const remaining = parseInt(
		headers['X-RateLimit-Remaining'] ?? headers['X-Rate-Limit-Remaining'] ?? headers['RateLimit-Remaining'] ?? '999',
		10
	);
	const reset = parseInt(
		headers['X-RateLimit-Reset'] ?? headers['X-Rate-Limit-Reset'] ?? headers['RateLimit-Reset'] ?? '0',
		10
	);
	if (!isNaN(remaining) && remaining < 5 && !isNaN(reset) && reset > 0) {
		return Math.max(0, reset * 1000 - Date.now() + 1000);
	}
	return 0;
}

registerBatchHandler('sparebank1_backfill', {
	// One month per step for active accounts; sparse accounts are fully fetched on first encounter.
	stepSizeDays: 31,

	async processStep(userId, stepFromDate, stepToDate, { currentStats, jobFromDate }) {
		const sensor = await getSparebank1Sensor(userId);
		if (!sensor) throw new Error('Ingen SpareBank1-sensor funnet');

		const accessToken = await getValidSparebank1AccessToken(sensor);
		const rateLimitHeaders: RateLimitSnapshot = {};
		await fetchSparebank1HelloWorld(accessToken, rateLimitHeaders);
		const allAccounts = await fetchSparebank1Accounts(accessToken, rateLimitHeaders);

		// Accounts already fully fetched in a previous step — skip them
		const fullFetchedKeys = new Set<string>(
			Array.isArray(currentStats?.fullFetchedAccounts) ? (currentStats.fullFetchedAccounts as string[]) : []
		);

		const sparseAccounts: any[] = [];
		const activeAccounts: any[] = [];
		const newlyFullFetched: string[] = [];

		// Probe each non-fully-fetched account with the current monthly window
		for (const account of allAccounts) {
			const key = getAccountKey(account);
			if (!key || fullFetchedKeys.has(key)) continue;

			const txns = await fetchSparebank1Transactions(
				accessToken, key,
				new Date(`${stepFromDate}T00:00:00Z`),
				new Date(`${stepToDate}T23:59:59Z`),
				rateLimitHeaders
			);

			if (txns.length < SPARSE_THRESHOLD) {
				// Sparse account: fetch full history now and never visit again
				sparseAccounts.push(account);
				newlyFullFetched.push(key);
			} else {
				// Active account: monthly window data will be written via syncAllSparebank1Data
				activeAccounts.push(account);
			}
		}

		let transactionsInserted = 0;

		// Sparse accounts: one sync call covering the full job range (jobFromDate → stepToDate)
		if (sparseAccounts.length > 0) {
			const result = await syncAllSparebank1Data(userId, {
				fromDate: new Date(`${jobFromDate}T00:00:00Z`),
				toDate: new Date(`${stepToDate}T23:59:59Z`),
				skipExistingDedup: true,
				prefetchedAccounts: { accounts: sparseAccounts, accessToken, rateLimitHeaders }
			});
			transactionsInserted += result.transactionEvents;
		}

		// Active accounts: monthly window only
		if (activeAccounts.length > 0) {
			const result = await syncAllSparebank1Data(userId, {
				fromDate: new Date(`${stepFromDate}T00:00:00Z`),
				toDate: new Date(`${stepToDate}T23:59:59Z`),
				skipExistingDedup: true,
				prefetchedAccounts: { accounts: activeAccounts, accessToken, rateLimitHeaders }
			});
			transactionsInserted += result.transactionEvents;
		}

		return {
			stats: {
				transactionsInserted,
				newlyFullFetchedAccounts: newlyFullFetched,
				rateLimitRemaining: rateLimitHeaders['X-RateLimit-Remaining'] ?? rateLimitHeaders['RateLimit-Remaining'] ?? null
			},
			waitMs: computeWaitMs(rateLimitHeaders) || undefined
		};
	},

	// processDay is required by the interface but never called when processStep is defined
	async processDay() {
		throw new Error('sparebank1_backfill bruker processStep, ikke processDay');
	},

	mergeStats(acc, step) {
		const prev = Array.isArray(acc.fullFetchedAccounts) ? (acc.fullFetchedAccounts as string[]) : [];
		const added = Array.isArray(step.newlyFullFetchedAccounts) ? (step.newlyFullFetchedAccounts as string[]) : [];
		return {
			transactionsInserted: ((acc.transactionsInserted as number) ?? 0) + ((step.transactionsInserted as number) ?? 0),
			fullFetchedAccounts: [...new Set([...prev, ...added])],
			rateLimitRemaining: step.rateLimitRemaining ?? acc.rateLimitRemaining ?? null
		};
	},

	initialStats() {
		return { transactionsInserted: 0, fullFetchedAccounts: [], rateLimitRemaining: null };
	}
});
