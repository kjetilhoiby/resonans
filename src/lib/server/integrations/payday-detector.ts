import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, asc, sql } from 'drizzle-orm';

const SALARY_KEYWORDS = ['lønn', 'lonn', 'salary', 'arbeidsgiver', 'folktrygd', 'nav '];
const SALARY_MIN_AMOUNT = 10_000;

export type GlobalPayday = {
	paydayDates: string[];           // YYYY-MM-DD, sorted
	detectedPaydayDom: number;       // typical day-of-month
	sourceAccountId: string | null;  // which account the salary was found on
};

/**
 * Detects payday dates by scanning transactions across ALL accounts for the
 * given user. The account with the clearest salary signal is used as source.
 * Returns null if no salary pattern can be detected.
 */
export async function detectGlobalPayday(userId: string): Promise<GlobalPayday | null> {
	// Fetch all income-sized transactions from all accounts
	const transactions = await db
		.select({
			accountId: sql<string>`data->>'accountId'`,
			amount:    sql<number>`(data->>'amount')::numeric`,
			description: sql<string>`data->>'description'`,
			typeText:  sql<string>`data->>'category'`,
			timestamp: sensorEvents.timestamp
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'bank_transaction'),
				sql`(data->>'amount')::numeric >= ${SALARY_MIN_AMOUNT}`
			)
		)
		.orderBy(asc(sensorEvents.timestamp));

	if (transactions.length === 0) return null;

	// ── Step 1: prefer keyword-matched salary transactions ───────────────────
	const salaryTxs = transactions.filter((t) => {
		const text = ((t.description ?? '') + ' ' + (t.typeText ?? '')).toLowerCase();
		return SALARY_KEYWORDS.some((kw) => text.includes(kw));
	});

	// ── Step 2: score each account by number of salary-keyword months ─────────
	// An account scores one point per calendar month it received a keyword-matched tx
	const accountScore = new Map<string, Set<string>>();
	for (const tx of salaryTxs) {
		const aid = tx.accountId;
		if (!aid) continue;
		const month = tx.timestamp.toISOString().slice(0, 7);
		if (!accountScore.has(aid)) accountScore.set(aid, new Set());
		accountScore.get(aid)!.add(month);
	}

	let sourceAccountId: string | null = null;
	let sourceTxs = salaryTxs;

	if (accountScore.size > 0) {
		// Pick the account with the most salary months
		sourceAccountId = [...accountScore.entries()]
			.sort((a, b) => b[1].size - a[1].size)[0][0];
		sourceTxs = salaryTxs.filter((t) => t.accountId === sourceAccountId);
	} else {
		// Fallback: find account with the largest single monthly inflow
		// (one per month, highest amount)
		const monthBest = new Map<string, { accountId: string; date: string; amount: number }>();
		for (const tx of transactions) {
			const amount = Number(tx.amount);
			const month = tx.timestamp.toISOString().slice(0, 7);
			const cur = monthBest.get(month);
			if (!cur || amount > cur.amount) {
				monthBest.set(month, {
					accountId: tx.accountId,
					date: tx.timestamp.toISOString().split('T')[0],
					amount
				});
			}
		}

		if (monthBest.size < 2) return null;

		// Tally which account wins the most months
		const fallbackScore = new Map<string, number>();
		for (const v of monthBest.values()) {
			fallbackScore.set(v.accountId, (fallbackScore.get(v.accountId) ?? 0) + 1);
		}
		sourceAccountId = [...fallbackScore.entries()]
			.sort((a, b) => b[1] - a[1])[0][0];

		// Build paydayDates from the fallback winner
		const paydayDates = [...monthBest.values()]
			.filter((v) => v.accountId === sourceAccountId)
			.map((v) => v.date)
			.sort();

		if (paydayDates.length < 2) return null;

		const doms = paydayDates.map((d) => new Date(d).getDate());
		const detectedPaydayDom = Math.round(doms.reduce((a, b) => a + b, 0) / doms.length);

		return { paydayDates, detectedPaydayDom, sourceAccountId };
	}

	// ── One salary tx per calendar month on source account ───────────────────
	const perMonth = new Map<string, string>(); // YYYY-MM → YYYY-MM-DD
	for (const tx of sourceTxs) {
		const d = tx.timestamp.toISOString().split('T')[0];
		const m = d.slice(0, 7);
		if (!perMonth.has(m)) perMonth.set(m, d);
	}

	const paydayDates = [...perMonth.values()].sort();
	if (paydayDates.length < 2) return null;

	const doms = paydayDates.map((d) => new Date(d).getDate());
	const detectedPaydayDom = Math.round(doms.reduce((a, b) => a + b, 0) / doms.length);

	return { paydayDates, detectedPaydayDom, sourceAccountId };
}
