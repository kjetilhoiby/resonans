import { db } from '$lib/db';
import { canonicalBankTransactions, sensorEvents } from '$lib/db/schema';
import { and, asc, eq, desc, sql } from 'drizzle-orm';
import {
	categorizeTransaction,
	detectRecurring,
	CATEGORIES
} from '$lib/server/integrations/transaction-categories';
import { loadMerchantMappings } from '$lib/server/integrations/spending-analyzer';
import { loadClassificationOverrides, loadTransactionMatchingRules } from '$lib/server/classification-overrides';

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
	// ── 1. Accounts ─────────────────────────────────────────────────────────
	const balanceRows = await db
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
		.orderBy(desc(sensorEvents.timestamp));

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
		loadMerchantMappings(userId),
		loadClassificationOverrides(userId, 'transaction'),
		loadTransactionMatchingRules()
	]);

	const txRows = await db
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
		.orderBy(desc(canonicalBankTransactions.canonicalDate));

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
	// Detect payday from canonical transactions — robust against lower salary amounts and varied descriptions.
	const SALARY_THRESHOLD = 8000;
	const INCOME_MIN_THRESHOLD = 4000;
	const PAYDAY_DEDUP_DAYS = 20;
	const historyFrom = new Date(now.getTime() - 220 * 24 * 60 * 60 * 1000);
	const SALARY_KEYWORDS = ['LONN', 'L\u00d8NN', 'SALARY', 'ARBEIDSGIVER', 'NAV', 'FOLKETRYGD'];

	const rawSalaryRows = await db
		.select({
			date: canonicalBankTransactions.canonicalDate,
			amount: canonicalBankTransactions.amount,
			description: sql<string>`COALESCE(${canonicalBankTransactions.descriptionDisplay}, ${canonicalBankTransactions.merchantKey}, '')`
		})
		.from(canonicalBankTransactions)
		.where(and(
			eq(canonicalBankTransactions.userId, userId),
			eq(canonicalBankTransactions.isActive, true),
			sql`${canonicalBankTransactions.amount} >= ${INCOME_MIN_THRESHOLD}`,
			sql`${canonicalBankTransactions.canonicalDate} >= ${historyFrom.toISOString().slice(0, 10)}::date`
		))
		.orderBy(desc(canonicalBankTransactions.canonicalDate));

	// Raw spending for comparison periods (no category resolution needed)
	const rawSpendRows = await db
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
		.orderBy(asc(canonicalBankTransactions.canonicalDate));

	const normalizedRawSalaryRows = rawSalaryRows.map((tx) => ({
		timestamp: canonicalDateToUtcDate(tx.date),
		amount: Number(tx.amount) || 0,
		description: tx.description ?? ''
	}));

	const normalizedRawSpendRows = rawSpendRows.map((tx) => ({
		timestamp: canonicalDateToUtcDate(tx.timestamp),
		amount: Number(tx.amount) || 0,
		description: tx.description ?? ''
	}));

	const GROCERY_KEYWORDS = ['KIWI', 'REMA', 'ODA ', 'MENY', 'SPAR', 'COOP', 'EXTRA', 'JOKER', 'BUNNPRIS', 'NÆRBUTIKK', 'BAMA'];
	const isGroceryTx = (d: string) => { const u = d.toUpperCase(); return GROCERY_KEYWORDS.some((k) => u.includes(k)); };

	const isLikelySalaryTx = (amount: number, description: string): boolean => {
		if (amount >= SALARY_THRESHOLD) return true;
		const upper = description.toUpperCase();
		return SALARY_KEYWORDS.some((keyword) => upper.includes(keyword));
	};

	const paydayCandidates = normalizedRawSalaryRows
		.filter((tx) => isLikelySalaryTx(tx.amount, tx.description ?? ''))
		.reduce<Array<{ timestamp: Date }>>((acc, tx) => {
		const last = acc[acc.length - 1];
		if (!last || last.timestamp.getTime() - tx.timestamp.getTime() > PAYDAY_DEDUP_DAYS * 24 * 60 * 60 * 1000) {
			acc.push({ timestamp: tx.timestamp });
		}
		return acc;
	}, []);

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
