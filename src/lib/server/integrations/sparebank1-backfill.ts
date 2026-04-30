import { registerBatchHandler } from '$lib/server/batch-runner';
import { getSparebank1Sensor, getValidSparebank1AccessToken, syncAllSparebank1Data } from './sparebank1-sync';
import {
	fetchSparebank1HelloWorld,
	fetchSparebank1Accounts,
	fetchSparebank1Transactions,
	type RateLimitSnapshot
} from './sparebank1';

// SpareBank1 allows 60 calls/hour = 1/min refill. A step needs ~2 + N_accounts calls.
const CALLS_PER_STEP = 15;
const REFILL_RATE_MS = 60_000;
const LOW_REMAINING_THRESHOLD = 15;

function getAccountKey(account: any): string {
	return String(account.key || account.accountKey || account.id || account.accountId || account.number || '');
}

function getTransactionDate(t: any): string | null {
	const raw = t.bookingDate || t.transactionDate || t.valueDate || t.date;
	if (!raw) return null;
	if (typeof raw === 'number') return new Date(raw).toISOString().split('T')[0];
	return String(raw).split('T')[0];
}

function dayBefore(dateStr: string): string {
	const d = new Date(`${dateStr}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - 1);
	return d.toISOString().split('T')[0];
}

function computeWaitMs(headers: RateLimitSnapshot): number {
	const remaining = parseInt(
		headers['X-RateLimit-Remaining'] ?? headers['X-Rate-Limit-Remaining'] ?? headers['RateLimit-Remaining'] ?? '999',
		10
	);
	if (isNaN(remaining) || remaining >= LOW_REMAINING_THRESHOLD) return 0;

	const reset = parseInt(
		headers['X-RateLimit-Reset'] ?? headers['X-Rate-Limit-Reset'] ?? headers['RateLimit-Reset'] ?? '0',
		10
	);
	if (!isNaN(reset) && reset > 0) {
		return Math.max(0, reset * 1000 - Date.now() + 1000);
	}
	const callsNeeded = Math.max(0, CALLS_PER_STEP - remaining);
	return callsNeeded * REFILL_RATE_MS;
}

registerBatchHandler('sparebank1_backfill', {
	// stepSizeDays is large so progress is tracked per-step rather than per-day.
	// Actual completion is determined by isDone (all account frontiers reached).
	stepSizeDays: 9999,

	isDone(stats) {
		const frontiers = stats.accountFrontiers as Record<string, string | null> | undefined;
		if (!frontiers || Object.keys(frontiers).length === 0) return false;
		return Object.values(frontiers).every((f) => f === null);
	},

	async processStep(userId, _stepFromDate, _stepToDate, { currentStats, jobFromDate, jobToDate }) {
		const sensor = await getSparebank1Sensor(userId);
		if (!sensor) throw new Error('Ingen SpareBank1-sensor funnet');

		const accessToken = await getValidSparebank1AccessToken(sensor);
		const rateLimitHeaders: RateLimitSnapshot = {};
		await fetchSparebank1HelloWorld(accessToken, rateLimitHeaders);
		const allAccounts = await fetchSparebank1Accounts(accessToken, rateLimitHeaders);

		const frontiers: Record<string, string | null> = {
			...((currentStats.accountFrontiers as Record<string, string | null>) ?? {})
		};

		// Pre-fetch transactions per account using adaptive windows.
		// frontier[key] = oldest date we still need to reach (null = complete).
		// Each call fetches jobFromDate → frontier, then updates frontier to just before
		// the oldest returned transaction. When oldest ≤ jobFromDate, the account is done.
		const prefetchedTransactions: Record<string, any[]> = {};

		for (const account of allAccounts) {
			const key = getAccountKey(account);
			if (!key) continue;
			if (frontiers[key] === null) continue; // already complete

			const toDate = frontiers[key] ?? jobToDate;

			const txns = await fetchSparebank1Transactions(
				accessToken,
				key,
				new Date(`${jobFromDate}T00:00:00Z`),
				new Date(`${toDate}T23:59:59Z`),
				rateLimitHeaders
			);

			prefetchedTransactions[key] = txns;

			const dates = txns
				.map(getTransactionDate)
				.filter((d): d is string => d !== null)
				.sort();
			const oldestDate = dates[0] ?? null;

			if (!oldestDate || oldestDate <= jobFromDate) {
				frontiers[key] = null; // reached the beginning — complete
			} else {
				frontiers[key] = dayBefore(oldestDate); // walk backwards next step
			}
		}

		// Write everything to DB; skip the external fetches since we already have the data.
		const result = await syncAllSparebank1Data(userId, {
			fromDate: new Date(`${jobFromDate}T00:00:00Z`),
			toDate: new Date(`${jobToDate}T23:59:59Z`),
			skipExistingDedup: true,
			prefetchedAccounts: { accounts: allAccounts, accessToken, rateLimitHeaders },
			prefetchedTransactions
		});

		const completedAccounts = Object.values(frontiers).filter((f) => f === null).length;
		const totalAccounts = Object.keys(frontiers).length;
		console.log(
			`[sparebank1-backfill] frontiers: ${completedAccounts}/${totalAccounts} accounts complete`,
			Object.entries(frontiers)
				.filter(([, f]) => f !== null)
				.map(([k, f]) => `${k}→${f}`)
		);

		return {
			stats: {
				transactionsInserted: ((currentStats.transactionsInserted as number) ?? 0) + result.transactionEvents,
				accountFrontiers: frontiers,
				rateLimitRemaining: rateLimitHeaders['X-RateLimit-Remaining'] ?? rateLimitHeaders['RateLimit-Remaining'] ?? null
			},
			waitMs: computeWaitMs(rateLimitHeaders) || undefined
		};
	},

	async processDay() {
		throw new Error('sparebank1_backfill bruker processStep, ikke processDay');
	},

	mergeStats(acc, step) {
		const accFrontiers = (acc.accountFrontiers ?? {}) as Record<string, string | null>;
		const stepFrontiers = (step.accountFrontiers ?? {}) as Record<string, string | null>;
		return {
			transactionsInserted: ((acc.transactionsInserted as number) ?? 0) + ((step.transactionsInserted as number) ?? 0),
			accountFrontiers: { ...accFrontiers, ...stepFrontiers },
			rateLimitRemaining: step.rateLimitRemaining ?? acc.rateLimitRemaining ?? null
		};
	},

	initialStats() {
		return { transactionsInserted: 0, accountFrontiers: {}, rateLimitRemaining: null };
	}
});
