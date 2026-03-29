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

	// ── 2. Current-month transactions ───────────────────────────────────────
	const now = new Date();
	const currentMonth = now.toISOString().slice(0, 7); // "2026-03"
	const monthStart = new Date(`${currentMonth}-01T00:00:00Z`);

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
				sql`timestamp >= ${monthStart.toISOString()}`
			)
		)
		.orderBy(desc(sensorEvents.timestamp));

	const txs = txRows.map((r) => ({
		timestamp: r.timestamp,
		amount: Number(r.amount) || 0,
		description: r.description ?? '',
		typeText: r.typeText ?? ''
	}));

	// ── 3. Categorise spending ───────────────────────────────────────────────
	const merchantMappingCache = await loadMerchantMappings(userId);

	const recurringKeys = detectRecurring(
		txs.map((t) => ({ description: t.description, amount: t.amount, month: currentMonth }))
	);

	const categoryMap = new Map<CategoryId, EconomicsCategoryRow>();
	let totalSpending = 0;
	let totalFixed = 0;
	let totalVariable = 0;
	let totalIncome = 0;

	for (const tx of txs) {
		const classified = categorizeTransaction(tx.description, tx.typeText, tx.amount, merchantMappingCache);
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
		const classified = categorizeTransaction(tx.description, tx.typeText, tx.amount, merchantMappingCache);
		const catDef = CATEGORIES[classified.category as CategoryId] ?? CATEGORIES['annet'];
		return {
			date: tx.timestamp.toISOString(),
			description: tx.description,
			amount: tx.amount,
			emoji: catDef.emoji,
			label: catDef.label
		};
	});

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
		recentTransactions
	};
}
