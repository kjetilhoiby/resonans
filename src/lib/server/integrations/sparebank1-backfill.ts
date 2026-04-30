import { registerBatchHandler } from '$lib/server/batch-runner';
import { getSparebank1Sensor, getValidSparebank1AccessToken, syncAllSparebank1Data } from './sparebank1-sync';
import {
	fetchSparebank1HelloWorld,
	fetchSparebank1Accounts,
	fetchSparebank1Transactions,
	type RateLimitSnapshot
} from './sparebank1';

// Max transactions per step. Each transaction costs 3 sequential DB queries in
// writeRawAndCanonicalTransactions, so 500 × 3 = 1500 queries per step.
const CHUNK_SIZE = 500;

function getAccountKey(account: any): string {
	return String(account.key || account.accountKey || account.id || account.accountId || account.number || '');
}

registerBatchHandler('sparebank1_backfill', {
	stepSizeDays: 1,

	// Runs once at job creation: fetches all accounts + all transactions (11 API calls total).
	// Everything is stored in payload.prefetchedData — no external calls in processStep.
	async prefetch(userId) {
		const sensor = await getSparebank1Sensor(userId);
		if (!sensor) throw new Error('Ingen SpareBank1-sensor funnet');

		const accessToken = await getValidSparebank1AccessToken(sensor);
		const rateLimitHeaders: RateLimitSnapshot = {};
		await fetchSparebank1HelloWorld(accessToken, rateLimitHeaders);
		const accounts = await fetchSparebank1Accounts(accessToken, rateLimitHeaders);

		console.log(`[sparebank1-backfill] prefetch: ${accounts.length} kontoer`);

		const transactionsByAccount: Record<string, any[]> = {};
		for (const account of accounts) {
			const key = getAccountKey(account);
			if (!key) continue;
			const name = String(account.name || account.accountName || key);
			const txns = await fetchSparebank1Transactions(accessToken, key, undefined, undefined, rateLimitHeaders);
			console.log(`[sparebank1-backfill] prefetch: ${name} → ${txns.length} transaksjoner`);
			transactionsByAccount[key] = txns;
		}

		const total = Object.values(transactionsByAccount).reduce((s, t) => s + t.length, 0);
		const totalChunks = Object.values(transactionsByAccount).reduce(
			(s, t) => s + Math.max(1, Math.ceil(t.length / CHUNK_SIZE)),
			0
		);
		console.log(`[sparebank1-backfill] prefetch ferdig: ${total} transaksjoner, ${totalChunks} steps`);

		return { accounts, transactionsByAccount, totalChunks };
	},

	isDone(stats) {
		const chunksWritten = (stats.chunksWritten as number | undefined) ?? 0;
		const totalChunks = (stats.totalChunks as number | undefined) ?? 0;
		return totalChunks > 0 && chunksWritten >= totalChunks;
	},

	// Each step: write one 500-transaction chunk for one account. No API calls.
	async processStep(userId, _stepFromDate, _stepToDate, { prefetchedData, currentStats }) {
		const allAccounts = (prefetchedData?.accounts ?? []) as any[];
		const transactionsByAccount = (prefetchedData?.transactionsByAccount ?? {}) as Record<string, any[]>;
		const totalChunks = (prefetchedData?.totalChunks as number | undefined) ?? 0;

		// accountOffsets tracks how many transactions have been written per account
		const accountOffsets: Record<string, number> = {
			...((currentStats.accountOffsets as Record<string, number> | undefined) ?? {})
		};

		// Find the next account with remaining transactions
		const account = allAccounts.find((a) => {
			const key = getAccountKey(a);
			if (!key) return false;
			const offset = accountOffsets[key] ?? 0;
			const total = transactionsByAccount[key]?.length ?? 0;
			return offset < total || (total === 0 && !(key in accountOffsets));
		});

		if (!account) {
			return {
				stats: {
					...(currentStats as Record<string, unknown>),
					totalChunks
				}
			};
		}

		const accountKey = getAccountKey(account);
		const accountName = String(account.name || account.accountName || accountKey);
		const allTxns = transactionsByAccount[accountKey] ?? [];
		const offset = accountOffsets[accountKey] ?? 0;

		// Mark empty accounts as done immediately without a DB write
		if (allTxns.length === 0) {
			accountOffsets[accountKey] = 0;
			console.log(`[sparebank1-backfill] ${accountName}: 0 transaksjoner, hopper over`);
			return {
				stats: {
					transactionsInserted: 0, // delta
					accountOffsets,
					chunksWritten: 1,        // delta
					totalChunks
				}
			};
		}

		const chunk = allTxns.slice(offset, offset + CHUNK_SIZE);
		const chunkEnd = offset + chunk.length;
		const isLastChunk = chunkEnd >= allTxns.length;

		console.log(
			`[sparebank1-backfill] ${accountName}: chunk ${offset}–${chunkEnd - 1} av ${allTxns.length}` +
			(isLastChunk ? ' (siste)' : '')
		);

		const sensor = await getSparebank1Sensor(userId);
		if (!sensor) throw new Error('Ingen SpareBank1-sensor funnet');
		const accessToken = await getValidSparebank1AccessToken(sensor);

		const result = await syncAllSparebank1Data(userId, {
			skipExistingDedup: true,
			prefetchedAccounts: { accounts: [account], accessToken, rateLimitHeaders: {} },
			prefetchedTransactions: { [accountKey]: chunk }
		});

		accountOffsets[accountKey] = chunkEnd;

		console.log(
			`[sparebank1-backfill] chunk ferdig: ${result.transactionEvents} nye transaksjoner`
		);

		return {
			stats: {
				transactionsInserted: result.transactionEvents, // delta only — mergeStats accumulates
				accountOffsets,
				chunksWritten: 1,                              // delta: 1 chunk this step
				totalChunks
			}
		};
	},

	async processDay() {
		throw new Error('sparebank1_backfill bruker processStep, ikke processDay');
	},

	mergeStats(acc, step) {
		return {
			transactionsInserted: ((acc.transactionsInserted as number) ?? 0) + ((step.transactionsInserted as number) ?? 0),
			accountOffsets: {
				...((acc.accountOffsets as Record<string, number> | undefined) ?? {}),
				...((step.accountOffsets as Record<string, number> | undefined) ?? {})
			},
			chunksWritten: ((acc.chunksWritten as number) ?? 0) + ((step.chunksWritten as number) ?? 0),
			totalChunks: (step.totalChunks as number | undefined) ?? (acc.totalChunks as number | undefined) ?? 0,
			rateLimitRemaining: step.rateLimitRemaining ?? acc.rateLimitRemaining ?? null
		};
	},

	initialStats() {
		return { transactionsInserted: 0, accountOffsets: {}, chunksWritten: 0, totalChunks: 0, rateLimitRemaining: null };
	}
});
