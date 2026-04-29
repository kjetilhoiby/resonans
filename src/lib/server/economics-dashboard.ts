import { db } from '$lib/db';
import { canonicalBankTransactions, sensorEvents } from '$lib/db/schema';
import { and, asc, eq, desc, sql } from 'drizzle-orm';
import { detectGlobalPayday } from './integrations/payday-detector';
import {
	categorizeTransaction,
	detectRecurring,
	CATEGORIES
} from '$lib/server/integrations/transaction-categories';
import { loadMerchantMappings } from '$lib/server/integrations/spending-analyzer';
import { loadClassificationOverrides, loadTransactionMatchingRules } from '$lib/server/classification-overrides';

async function measureStep<T>(label: string, userId: string, op: () => Promise<T>): Promise<T> {
	const t0 = performance.now();
	try {
		const result = await op();
		const count = Array.isArray(result) ? result.length : result ? 1 : 0;
		console.log(`[perf][economics-dashboard] user=${userId} step=${label} ms=${(performance.now() - t0).toFixed(0)} count=${count}`);
		return result;
	} catch (error) {
		console.error(`[perf][economics-dashboard] user=${userId} step=${label} failed ms=${(performance.now() - t0).toFixed(0)}`);
		throw error;
	}
}

export type EconomicsAccount = {
	accountId: string;
	accountName: string | null;
	accountType: string | null;
	balance: number;
	currency: string | null;
};

export type EconomicsCategoryRow = {
	category: string;
	label: string;
	emoji: string;
	amount: number;
	count: number;
	isFixed: boolean;
};

export type EconomicsRecentTx = {
	date: string;
	description: string;
	amount: number;
	category: string;
	emoji: string;
	label: string;
};

export type EconomicsTx = {
	date: string;       // ISO string
	description: string;
	amount: number;     // negative = spending
	category: string;
	emoji: string;
	label: string;
};

export type PaydaySpend = {
	paydayDate: string | null;
	daysSincePayday: number;
	totalSpend: number;
	spendPerDay: number;
	grocerySpend: number;
	grocerySpendPerDay: number;
	prevSpendPerDay: number | null;
	prevGrocerySpendPerDay: number | null;
	comparisonPeriodsUsed: number;
	averageComparisonPoints: Array<{ day: number; total: number; grocery: number }>;
	transactions: EconomicsTx[];
	groceryTransactions: EconomicsTx[];
};

export type EconomicsDashboardData = {
	accounts: EconomicsAccount[];
	totalBalance: number;
	currentMonth: string; // "2026-03"
	monthSpending: {
		totalSpending: number;
		totalFixed: number;
		totalVariable: number;
		totalIncome: number;
		categories: EconomicsCategoryRow[];
	};
	recentTransactions: EconomicsRecentTx[];
	paydaySpend: PaydaySpend;
};

function canonicalDateToUtcDate(value: string | Date): Date {
	if (value instanceof Date) {
		return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 12, 0, 0, 0));
	}
	if (value.includes('T')) {
		const parsed = new Date(value);
		return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 12, 0, 0, 0));
	}
	return new Date(`${value}T12:00:00Z`);
}

export async function loadEconomicsDashboardData(userId: string): Promise<EconomicsDashboardData> {
	const tTotal = performance.now();
	// ── 1. Accounts ─────────────────────────────────────────────────────────
	const balanceRows = await measureStep('bank_balance_rows', userId, () =>
		db
			.select({
				accountId: sql<string>`data->>'accountId'`,
				accountName: sql<string>`data->>'accountName'`,
				accountType: sql<string>`data->>'accountType'`,
				balance: sql<number>`(data->>'balance')::numeric`,
				currency: sql<string>`data->>'currency'`,
				ts: sensorEvents.timestamp
			})
			.from(sensorEvents)
			.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'bank_balance')))
			.orderBy(desc(sensorEvents.timestamp))
	);

	const seenAccounts = new Set<string>();
	const accounts: EconomicsAccount[] = balanceRows
		.filter((r) => {
			if (!r.accountId || seenAccounts.has(r.accountId)) return false;
			seenAccounts.add(r.accountId);
			return true;
		})
		.map((r) => ({
			accountId: r.accountId,
			accountName: r.accountName,
			accountType: r.accountType,
			balance: Number(r.balance) || 0,
			currency: r.currency
		}))
		.sort((a, b) => b.balance - a.balance);

	const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);

	// ── 2. Transactions — enough history for current + four previous salary periods ──
	const now = new Date();
	const currentMonth = now.toISOString().slice(0, 7); // "2026-03"
	const monthStart = new Date(`${currentMonth}-01T00:00:00Z`);
	const queryFrom = new Date(now.getTime() - 70 * 24 * 60 * 60 * 1000);
	const [merchantMappings, overrides, rules] = await Promise.all([
		measureStep('merchant_mappings', userId, () => loadMerchantMappings(userId)),
		measureStep('classification_overrides', userId, () => loadClassificationOverrides(userId, 'transaction')),
		measureStep('transaction_rules', userId, () => loadTransactionMatchingRules())
	]);

	const txRows = await measureStep('canonical_transactions', userId, () =>
		db
			.select({
				date: canonicalBankTransactions.canonicalDate,
				amount: canonicalBankTransactions.amount,
				description: canonicalBankTransactions.descriptionDisplay,
				merchantKey: canonicalBankTransactions.merchantKey
			})
			.from(canonicalBankTransactions)
			.where(
				and(
					eq(canonicalBankTransactions.userId, userId),
					eq(canonicalBankTransactions.isActive, true),
					sql`${canonicalBankTransactions.canonicalDate} >= ${queryFrom.toISOString().slice(0, 10)}::date`
				)
			)
			.orderBy(desc(canonicalBankTransactions.canonicalDate))
	);

	const allTxs = txRows.map((r) => ({
		timestamp: canonicalDateToUtcDate(r.date),
		amount: Number(r.amount) || 0,
		description: (r.description ?? r.merchantKey ?? '').trim(),
		...categorizeTransaction(
			r.description ?? r.merchantKey ?? '',
			null,
			Number(r.amount) || 0,
			merchantMappings,
			overrides,
			rules
		)
	}));

	// Current-month slice for monthly spending stats
	const txs = allTxs.filter((t) => t.timestamp >= monthStart);

	// ── 3. Categorise spending ───────────────────────────────────────────────

	const recurringKeys = detectRecurring(
		txs.map((t) => ({ description: t.description, amount: t.amount, month: currentMonth }))
	);

	const categoryMap = new Map<string, EconomicsCategoryRow>();
	let totalSpending = 0;
	let totalFixed = 0;
	let totalVariable = 0;
	let totalIncome = 0;

	for (const tx of txs) {
		const key = `${tx.description.toLowerCase().trim()}|${Math.round(tx.amount / 10) * 10}`;
		const isFixed = tx.isFixed || recurringKeys.has(key);
		const absAmount = Math.abs(tx.amount);

		if (tx.amount > 0) {
			totalIncome += absAmount;
			continue;
		}

		totalSpending += absAmount;
		if (isFixed) totalFixed += absAmount;
		else totalVariable += absAmount;

		const catId = tx.category || 'ukategorisert';
		const catDef = CATEGORIES[catId as keyof typeof CATEGORIES] ?? CATEGORIES['ukategorisert'];

		if (!categoryMap.has(catId)) {
			categoryMap.set(catId, {
				category: catId,
				label: catDef.label,
				emoji: catDef.emoji,
				amount: 0,
				count: 0,
				isFixed
			});
		}
		const row = categoryMap.get(catId)!;
		row.amount += absAmount;
		row.count += 1;
	}

	const categories: EconomicsCategoryRow[] = [...categoryMap.values()].sort(
		(a, b) => b.amount - a.amount
	);

	// ── 4. Recent transactions (last 8, any direction) ──────────────────────
	// Use allTxs (not txs) so we always show 8 entries even early in the month
	const recentTransactions: EconomicsRecentTx[] = allTxs.slice(0, 8).map((tx) => {
		const catDef = CATEGORIES[tx.category as keyof typeof CATEGORIES] ?? CATEGORIES['ukategorisert'];
		return {
			date: tx.timestamp.toISOString(),
			description: tx.description,
			amount: tx.amount,
			category: tx.category ?? 'ukategorisert',
			emoji: tx.emoji ?? catDef.emoji,
			label: tx.label ?? catDef.label
		};
	});

	// ── 5. Payday spend — spending per day since last salary ─────────────────
	const historyFrom = new Date(now.getTime() - 220 * 24 * 60 * 60 * 1000);

	const [globalPayday, rawSpendRows] = await Promise.all([
		measureStep('detect_payday', userId, () => detectGlobalPayday(userId)),
		measureStep('spend_rows_for_payday', userId, () =>
			db
				.select({
					timestamp: canonicalBankTransactions.canonicalDate,
					amount: canonicalBankTransactions.amount,
					description: sql<string>`COALESCE(${canonicalBankTransactions.descriptionDisplay}, ${canonicalBankTransactions.merchantKey}, '')`,
				})
				.from(canonicalBankTransactions)
				.where(and(
					eq(canonicalBankTransactions.userId, userId),
					eq(canonicalBankTransactions.isActive, true),
					sql`${canonicalBankTransactions.amount} < 0`,
					sql`${canonicalBankTransactions.canonicalDate} >= ${historyFrom.toISOString().slice(0, 10)}::date`
				))
				.orderBy(asc(canonicalBankTransactions.canonicalDate))
		)
	]);

	const normalizedRawSpendRows = rawSpendRows.map((tx) => ({
		timestamp: canonicalDateToUtcDate(tx.timestamp),
		amount: Number(tx.amount) || 0,
		description: tx.description ?? ''
	}));

	const GROCERY_KEYWORDS = ['KIWI', 'REMA', 'ODA ', 'MENY', 'SPAR', 'COOP', 'EXTRA', 'JOKER', 'BUNNPRIS', 'NÆRBUTIKK', 'BAMA'];
	const isGroceryTx = (d: string) => { const u = d.toUpperCase(); return GROCERY_KEYWORDS.some((k) => u.includes(k)); };

	// Use payday dates from detectGlobalPayday (most recent first, filtered to ≤ today)
	const todayStr = now.toISOString().slice(0, 10);
	const paydayCandidates: Array<{ timestamp: Date }> = (globalPayday?.paydayDates ?? [])
		.filter((d) => d <= todayStr)
		.reverse()
		.map((d) => ({ timestamp: new Date(`${d}T12:00:00Z`) }));

	const currentPayday = paydayCandidates[0] ?? null;
	const prevPayday = paydayCandidates[1] ?? null;

	const paydayDate = currentPayday ? currentPayday.timestamp.toISOString() : null;
	const paydayStart = currentPayday
		? new Date(new Date(currentPayday.timestamp).setHours(0, 0, 0, 0))
		: monthStart;

	const msPerDay = 24 * 60 * 60 * 1000;
	const daysSincePayday = Math.max(
		1,
		Math.round((now.getTime() - paydayStart.getTime()) / msPerDay)
	);

	// Categorise all txs since payday (spending only)
	const txsSincePayday = allTxs.filter(
		(t) => t.timestamp >= paydayStart && t.amount < 0
	);

	let totalSpendSincePayday = 0;
	let grocerySpendSincePayday = 0;
	const paydayTxList: EconomicsTx[] = [];
	const groceryTxList: EconomicsTx[] = [];

	for (const tx of txsSincePayday) {
		const catDef = CATEGORIES[tx.category as keyof typeof CATEGORIES] ?? CATEGORIES['ukategorisert'];
		const absAmt = Math.abs(tx.amount);
		totalSpendSincePayday += absAmt;

		const txEntry: EconomicsTx = {
			date: tx.timestamp.toISOString(),
			description: tx.description,
			amount: tx.amount,
			category: tx.category,
			emoji: tx.emoji ?? catDef.emoji,
			label: tx.label ?? catDef.label
		};
		paydayTxList.push(txEntry);

		if (tx.category === 'dagligvarer') {
			grocerySpendSincePayday += absAmt;
			groceryTxList.push(txEntry);
		}
	}

	const spendPerDay = totalSpendSincePayday / daysSincePayday;
	const grocerySpendPerDay = grocerySpendSincePayday / daysSincePayday;

	// Previous month same window
	let prevSpendPerDay: number | null = null;
	let prevGrocerySpendPerDay: number | null = null;

	if (prevPayday) {
		const prevStart = new Date(new Date(prevPayday.timestamp).setHours(0, 0, 0, 0));
		const prevEnd = new Date(prevStart.getTime() + daysSincePayday * msPerDay);

		const prevTxs = normalizedRawSpendRows.filter(
			(t) => t.timestamp >= prevStart && t.timestamp < prevEnd
		);

		let prevTotal = 0;
		let prevGrocery = 0;
		for (const tx of prevTxs) {
			const absAmt = Math.abs(tx.amount);
			prevTotal += absAmt;
			if (isGroceryTx(tx.description ?? '')) prevGrocery += absAmt;
		}

		const prevDays = Math.max(1, Math.round((prevEnd.getTime() - prevStart.getTime()) / msPerDay));
		prevSpendPerDay = prevTotal / prevDays;
		prevGrocerySpendPerDay = prevGrocery / prevDays;
	}

	const averageComparisonPoints: Array<{ day: number; total: number; grocery: number }> = [];
	const previousPeriods = paydayCandidates.slice(1, 5);

	if (previousPeriods.length > 0) {
		const perPeriodSeries = previousPeriods.flatMap((periodStartTx, index) => {
			const newerBoundary = paydayCandidates[index];
			if (!newerBoundary) return [];

			const periodStart = new Date(new Date(periodStartTx.timestamp).setHours(0, 0, 0, 0));
			const periodEnd = new Date(new Date(newerBoundary.timestamp).setHours(0, 0, 0, 0));
			const periodLengthDays = Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / msPerDay));
			const maxDays = periodLengthDays;

			const totalsByDay = new Map<number, { total: number; grocery: number }>();
			for (const tx of normalizedRawSpendRows) {
				if (tx.timestamp < periodStart || tx.timestamp >= periodEnd) continue;
				const dayIndex = Math.floor((tx.timestamp.getTime() - periodStart.getTime()) / msPerDay) + 1;
				if (dayIndex < 1 || dayIndex > maxDays) continue;
				const prev = totalsByDay.get(dayIndex) ?? { total: 0, grocery: 0 };
				prev.total += Math.abs(tx.amount);
				if (isGroceryTx(tx.description ?? '')) prev.grocery += Math.abs(tx.amount);
				totalsByDay.set(dayIndex, prev);
			}

			let cumulativeTotal = 0;
			let cumulativeGrocery = 0;
			const series: Array<{ day: number; total: number; grocery: number }> = [];
			for (let day = 1; day <= maxDays; day += 1) {
				const dayTotals = totalsByDay.get(day);
				cumulativeTotal += dayTotals?.total ?? 0;
				cumulativeGrocery += dayTotals?.grocery ?? 0;
				series.push({ day, total: cumulativeTotal, grocery: cumulativeGrocery });
			}
			return [series];
		});

		const maxComparisonDays = perPeriodSeries.length > 0 ? Math.max(...perPeriodSeries.map((s) => s.length)) : 0;
		for (let day = 1; day <= maxComparisonDays; day += 1) {
			const pointsForDay = perPeriodSeries
				.map((series) => series.find((point) => point.day === day) ?? null)
				.filter((point): point is { day: number; total: number; grocery: number } => point !== null);

			if (pointsForDay.length === 0) continue;

			averageComparisonPoints.push({
				day,
				total: pointsForDay.reduce((sum, point) => sum + point.total, 0) / pointsForDay.length,
				grocery: pointsForDay.reduce((sum, point) => sum + point.grocery, 0) / pointsForDay.length
			});
		}
	}

	const paydaySpend: PaydaySpend = {
		paydayDate,
		daysSincePayday,
		totalSpend: totalSpendSincePayday,
		spendPerDay,
		grocerySpend: grocerySpendSincePayday,
		grocerySpendPerDay,
		prevSpendPerDay,
		prevGrocerySpendPerDay,
		comparisonPeriodsUsed: previousPeriods.length,
		averageComparisonPoints,
		transactions: paydayTxList,
		groceryTransactions: groceryTxList
	};

	console.log(`[perf][economics-dashboard] user=${userId} step=total ms=${(performance.now() - tTotal).toFixed(0)}`);

	return {
		accounts,
		totalBalance,
		currentMonth,
		monthSpending: {
			totalSpending,
			totalFixed,
			totalVariable,
			totalIncome,
			categories
		},
		recentTransactions,
		paydaySpend
	};
}
