import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, desc, sql } from 'drizzle-orm';
import {
	categorizeTransaction,
	detectRecurring,
	CATEGORIES,
	type CategoryId
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

	// ── 2. Transactions — 70 days for payday comparison ────────────────────
	const now = new Date();
	const currentMonth = now.toISOString().slice(0, 7); // "2026-03"
	const monthStart = new Date(`${currentMonth}-01T00:00:00Z`);
	const queryFrom = new Date(now.getTime() - 70 * 24 * 60 * 60 * 1000);

	const txRows = await db
		.select({
			timestamp: sensorEvents.timestamp,
			amount: sql<number>`(data->>'amount')::numeric`,
			description: sql<string>`data->>'description'`,
			typeText: sql<string>`data->>'category'`
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'bank_transaction'),
				sql`timestamp >= ${queryFrom.toISOString()}`
			)
		)
		.orderBy(desc(sensorEvents.timestamp));

	const allTxs = txRows.map((r) => ({
		timestamp: r.timestamp,
		amount: Number(r.amount) || 0,
		description: r.description ?? '',
		typeText: r.typeText ?? ''
	}));

	// Current-month slice for monthly spending stats
	const txs = allTxs.filter((t) => t.timestamp >= monthStart);

	// ── 3. Categorise spending ───────────────────────────────────────────────
	const [merchantMappingCache, transactionOverrideCache, transactionRules] = await Promise.all([
		loadMerchantMappings(userId),
		loadClassificationOverrides(userId, 'transaction'),
		loadTransactionMatchingRules()
	]);

	const recurringKeys = detectRecurring(
		txs.map((t) => ({ description: t.description, amount: t.amount, month: currentMonth }))
	);

	const categoryMap = new Map<CategoryId, EconomicsCategoryRow>();
	let totalSpending = 0;
	let totalFixed = 0;
	let totalVariable = 0;
	let totalIncome = 0;

	for (const tx of txs) {
		const classified = categorizeTransaction(tx.description, tx.typeText, tx.amount, merchantMappingCache, transactionOverrideCache, transactionRules);
		const key = `${tx.description.toLowerCase().trim()}|${Math.round(tx.amount / 10) * 10}`;
		const isFixed = classified.isFixed || recurringKeys.has(key);
		const absAmount = Math.abs(tx.amount);

		if (tx.amount > 0) {
			totalIncome += absAmount;
			continue;
		}

		totalSpending += absAmount;
		if (isFixed) totalFixed += absAmount;
		else totalVariable += absAmount;

		const catId = classified.category as CategoryId;
		const catDef = CATEGORIES[catId] ?? CATEGORIES['annet'];

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
	const recentTransactions: EconomicsRecentTx[] = txs.slice(0, 8).map((tx) => {
		const classified = categorizeTransaction(tx.description, tx.typeText, tx.amount, merchantMappingCache, transactionOverrideCache, transactionRules);
		const catDef = CATEGORIES[classified.category as CategoryId] ?? CATEGORIES['annet'];
		return {
			date: tx.timestamp.toISOString(),
			description: tx.description,
			amount: tx.amount,
			emoji: catDef.emoji,
			label: catDef.label
		};
	});

	// ── 5. Payday spend — spending per day since last salary ─────────────────
	// Detect payday: most recent income tx > 15 000 kr (salary threshold)
	const SALARY_THRESHOLD = 15000;
	const incomeTxsSorted = allTxs
		.filter((t) => t.amount >= SALARY_THRESHOLD)
		.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

	const currentPayday = incomeTxsSorted[0] ?? null;
	// Previous payday: large income at least 10 days before the current one
	const prevPayday = incomeTxsSorted.find(
		(t) =>
			currentPayday &&
			currentPayday.timestamp.getTime() - t.timestamp.getTime() > 10 * 24 * 60 * 60 * 1000
	) ?? null;

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
		const classified = categorizeTransaction(tx.description, tx.typeText, tx.amount, merchantMappingCache, transactionOverrideCache, transactionRules);
		const catDef = CATEGORIES[classified.category as CategoryId] ?? CATEGORIES['annet'];
		const absAmt = Math.abs(tx.amount);
		totalSpendSincePayday += absAmt;

		const txEntry: EconomicsTx = {
			date: tx.timestamp.toISOString(),
			description: tx.description,
			amount: tx.amount,
			category: classified.category,
			emoji: catDef.emoji,
			label: catDef.label
		};
		paydayTxList.push(txEntry);

		if (classified.category === 'dagligvarer') {
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

		const prevTxs = allTxs.filter(
			(t) => t.timestamp >= prevStart && t.timestamp < prevEnd && t.amount < 0
		);

		let prevTotal = 0;
		let prevGrocery = 0;
		for (const tx of prevTxs) {
			const classified = categorizeTransaction(tx.description, tx.typeText, tx.amount, merchantMappingCache, transactionOverrideCache, transactionRules);
			const absAmt = Math.abs(tx.amount);
			prevTotal += absAmt;
			if (classified.category === 'dagligvarer') prevGrocery += absAmt;
		}

		const prevDays = Math.max(1, Math.round((prevEnd.getTime() - prevStart.getTime()) / msPerDay));
		prevSpendPerDay = prevTotal / prevDays;
		prevGrocerySpendPerDay = prevGrocery / prevDays;
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
