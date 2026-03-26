import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, sql, asc } from 'drizzle-orm';
import {
	categorizeTransaction,
	type CategoryId
} from '$lib/server/integrations/transaction-categories';
import { loadMerchantMappings } from '$lib/server/integrations/spending-analyzer';
import type { RequestHandler } from './$types';

// Categories excluded from this view
const EXCLUDED_CATEGORIES: CategoryId[] = [
	'dagligvare',
	'overføring',
	'lønn',
	'lån',
	'sparing',
];

export type IrregularTransaction = {
	date: string;
	amount: number; // absolute value (positive)
	description: string;
};

export type IrregularMerchant = {
	key: string;
	label: string;
	category: CategoryId;
	emoji: string;
	totalAmount: number;
	txCount: number;
	avgAmount: number;
	minAmount: number;
	maxAmount: number;
	/** Coefficient of variation (higher = more variable amounts) */
	cv: number;
	/** Which months this merchant was active (YYYY-MM) */
	activeMonths: string[];
	transactions: IrregularTransaction[];
};

export type IrregularResponse = {
	merchants: IrregularMerchant[];
	/** Total months covered by the data window */
	monthsInRange: number;
	/** Sum of all irregular spending */
	totalAmount: number;
};

/**
 * GET /api/economics/irregular?accountId=xxx&months=18
 *
 * Returns variable/irregular spending grouped by merchant.
 * Excludes groceries and fixed recurring charges.
 * Merchants are ranked by total spend.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const accountId = url.searchParams.get('accountId');
	const monthsBack = Math.min(24, parseInt(url.searchParams.get('months') ?? '18'));
	const minAmount = parseInt(url.searchParams.get('minAmount') ?? '500');

	const cutoff = new Date();
	cutoff.setMonth(cutoff.getMonth() - monthsBack);
	cutoff.setDate(1);
	cutoff.setHours(0, 0, 0, 0);

	const where = accountId
		? and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'bank_transaction'),
				sql`data->>'accountId' = ${accountId}`,
				sql`timestamp >= ${cutoff.toISOString()}`
			)
		: and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'bank_transaction'),
				sql`timestamp >= ${cutoff.toISOString()}`
			);

	const rows = await db
		.select({
			timestamp: sensorEvents.timestamp,
			amount: sql<number>`(data->>'amount')::numeric`,
			description: sql<string>`data->>'description'`,
			typeText: sql<string>`data->>'category'`
		})
		.from(sensorEvents)
		.where(where)
		.orderBy(asc(sensorEvents.timestamp));

	if (rows.length === 0) {
		return json({ merchants: [], monthsInRange: monthsBack, totalAmount: 0 } as IrregularResponse);
	}

	const merchantMappings = await loadMerchantMappings(userId);

	// Build merchant groups
	type TxRow = {
		date: string; // YYYY-MM-DD
		month: string; // YYYY-MM
		dayOfMonth: number;
		amount: number;
		description: string;
		category: CategoryId;
		label: string;
		emoji: string;
	};

	const merchantMap = new Map<string, TxRow[]>();

	for (const r of rows) {
		const amount = Number(r.amount) || 0;
		if (amount >= 0) continue; // only spending (negative = outgoing)
		const abs = Math.abs(amount);
		if (abs < minAmount) continue;

		const cat = categorizeTransaction(r.description, r.typeText, amount, merchantMappings);
		if (EXCLUDED_CATEGORIES.includes(cat.category)) continue;

		const key = (r.description ?? 'ukjent').toLowerCase().trim();
		const date = r.timestamp.toISOString().slice(0, 10);
		const month = date.slice(0, 7);
		const dayOfMonth = r.timestamp.getDate();

		const tx: TxRow = {
			date,
			month,
			dayOfMonth,
			amount: abs,
			description: r.description ?? key,
			category: cat.category,
			label: cat.label,
			emoji: cat.emoji
		};

		if (!merchantMap.has(key)) merchantMap.set(key, []);
		merchantMap.get(key)!.push(tx);
	}

	// Compute stats and decide regularity
	const monthsSet: Set<string> = new Set(rows.map((r) => r.timestamp.toISOString().slice(0, 7)));
	const totalMonths = monthsSet.size;

	const merchants: IrregularMerchant[] = [];

	for (const [key, txs] of merchantMap) {
		if (txs.length === 0) continue;

		const amounts = txs.map((t) => t.amount);
		const totalAmount = amounts.reduce((a, b) => a + b, 0);
		const avgAmount = totalAmount / amounts.length;
		const minAmt = Math.min(...amounts);
		const maxAmt = Math.max(...amounts);

		// Coefficient of variation (std dev / mean)
		const variance = amounts.reduce((acc, a) => acc + (a - avgAmount) ** 2, 0) / amounts.length;
		const cv = Math.sqrt(variance) / (avgAmount || 1);

		// Active months
		const activeMonths = [...new Set(txs.map((t) => t.month))].sort();
		const activeFraction = activeMonths.length / totalMonths;

		// Date-of-month regularity: std dev of day numbers
		const days = txs.map((t) => t.dayOfMonth);
		const avgDay = days.reduce((a, b) => a + b, 0) / days.length;
		const dayVariance = days.reduce((acc, d) => acc + (d - avgDay) ** 2, 0) / days.length;
		const dayStdDev = Math.sqrt(dayVariance);

		// A merchant is "regular" (fixed-subscription-like) if:
		//   - appears in ≥75% of all months in range
		//   - AND amounts are very consistent (CV < 0.20)
		//   - AND date of month is consistent (std dev < 5 days)
		const isRegular = activeFraction >= 0.75 && cv < 0.20 && dayStdDev < 5;
		if (isRegular) continue;

		const sample = txs[0];
		merchants.push({
			key,
			label: sample.description,
			category: sample.category,
			emoji: sample.emoji,
			totalAmount,
			txCount: txs.length,
			avgAmount,
			minAmount: minAmt,
			maxAmount: maxAmt,
			cv,
			activeMonths,
			transactions: txs
				.map((t) => ({ date: t.date, amount: t.amount, description: t.description }))
				.sort((a, b) => b.date.localeCompare(a.date))
		});
	}

	// Sort by total spend descending
	merchants.sort((a, b) => b.totalAmount - a.totalAmount);

	const totalAmount = merchants.reduce((acc, m) => acc + m.totalAmount, 0);

	return json({ merchants, monthsInRange: totalMonths, totalAmount } as IrregularResponse);
};
