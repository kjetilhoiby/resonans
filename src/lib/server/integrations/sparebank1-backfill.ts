import { registerBatchHandler } from '$lib/server/batch-runner';
import { syncAllSparebank1Data } from './sparebank1-sync';
import type { RateLimitSnapshot } from './sparebank1';

/**
 * Compute how many ms to wait before the next step based on rate-limit response headers.
 * Returns 0 if quota is healthy, or ms until reset + 1s buffer if we're running low.
 */
function computeWaitMs(headers: RateLimitSnapshot): number {
	const remaining = parseInt(
		headers['X-RateLimit-Remaining'] ??
		headers['X-Rate-Limit-Remaining'] ??
		headers['RateLimit-Remaining'] ??
		'999',
		10
	);
	const reset = parseInt(
		headers['X-RateLimit-Reset'] ??
		headers['X-Rate-Limit-Reset'] ??
		headers['RateLimit-Reset'] ??
		'0',
		10
	);

	if (!isNaN(remaining) && remaining < 5 && !isNaN(reset) && reset > 0) {
		const resetMs = reset * 1000;
		return Math.max(0, resetMs - Date.now() + 1000);
	}
	return 0;
}

registerBatchHandler('sparebank1_backfill', {
	// One month per step: reduces API calls from N_days × N_accounts to N_months × N_accounts.
	// Monthly windows are small enough that SpareBank1 returns complete data without pagination.
	stepSizeDays: 31,

	async processStep(userId, fromDate, toDate) {
		const result = await syncAllSparebank1Data(userId, {
			fromDate: new Date(`${fromDate}T00:00:00Z`),
			toDate: new Date(`${toDate}T23:59:59Z`),
			skipExistingDedup: false
		});

		const waitMs = computeWaitMs(result.rateLimitHeaders);

		return {
			stats: {
				transactionsInserted: result.transactionEvents,
				monthsWithTransactions: result.transactionEvents > 0 ? 1 : 0,
				rateLimitRemaining: result.rateLimitHeaders['X-RateLimit-Remaining'] ??
					result.rateLimitHeaders['RateLimit-Remaining'] ?? null
			},
			waitMs: waitMs > 0 ? waitMs : undefined
		};
	},

	// processDay is required by the interface but never called when processStep is defined
	async processDay(userId, date) {
		throw new Error('sparebank1_backfill bruker processStep, ikke processDay');
	},

	mergeStats(acc, step) {
		return {
			transactionsInserted: ((acc.transactionsInserted as number) ?? 0) + ((step.transactionsInserted as number) ?? 0),
			monthsWithTransactions: ((acc.monthsWithTransactions as number) ?? 0) + ((step.monthsWithTransactions as number) ?? 0),
			rateLimitRemaining: step.rateLimitRemaining ?? acc.rateLimitRemaining ?? null
		};
	},

	initialStats() {
		return { transactionsInserted: 0, monthsWithTransactions: 0, rateLimitRemaining: null };
	}
});
