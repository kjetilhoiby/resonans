import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, asc, sql } from 'drizzle-orm';
import {
	categorizeTransaction,
	detectRecurring,
	CATEGORIES,
	type CategoryId
} from '$lib/server/integrations/transaction-categories';
import { loadMerchantMappings } from '$lib/server/integrations/spending-analyzer';
import type { RequestHandler } from './$types';

/**
 * GET /api/economics/spending?accountId=xxx&months=12
 *
 * Returns monthly spending grouped by category, with fixed/variable split.
 * Response:
 * {
 *   months: [{
 *     month: "2025-01",
 *     categories: [{ category, label, emoji, amount, count, isFixed }],
 *     totalSpending: number,
 *     totalFixed: number,
 *     totalVariable: number,
 *     totalIncome: number,
 *   }],
 *   allCategories: [{ category, label, emoji }]
 * }
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const accountId = url.searchParams.get('accountId'); // null = all accounts
	const monthsBack = Math.min(24, parseInt(url.searchParams.get('months') ?? '12'));

	// Fetch raw transactions
	const where = accountId
		? and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'bank_transaction'),
				sql`data->>'accountId' = ${accountId}`
			)
		: and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'bank_transaction'));

	const rows = await db
		.select({
			timestamp: sensorEvents.timestamp,
			amount: sql<number>`(data->>'amount')::numeric`,
			description: sql<string>`data->>'description'`,
			category: sql<string>`data->>'category'`,
			accountId: sql<string>`data->>'accountId'`
		})
		.from(sensorEvents)
		.where(where)
		.orderBy(asc(sensorEvents.timestamp));

	if (rows.length === 0) {
		return json({ months: [], allCategories: Object.values(CATEGORIES) });
	}

	// Load per-user merchant mappings (LLM-generated) — checked first in categorizeTransaction
	const merchantMappingCache = await loadMerchantMappings(userId);

	// Filter to monthsBack window
	const cutoff = new Date();
	cutoff.setMonth(cutoff.getMonth() - monthsBack);
	cutoff.setDate(1);
	cutoff.setHours(0, 0, 0, 0);

	const txs = rows
		.map((r) => ({
			timestamp: r.timestamp,
			month: r.timestamp.toISOString().slice(0, 7),
			amount: Number(r.amount) || 0,
			description: r.description,
			typeText: r.category
		}))
		.filter((r) => r.timestamp >= cutoff);

	// Detect recurring merchants (used to override isFixed)
	const recurringKeys = detectRecurring(
		txs.map((t) => ({ description: t.description, amount: t.amount, month: t.month }))
	);

	function isRecurring(description: string | null, amount: number): boolean {
		if (!description) return false;
		const key = description.toLowerCase().trim();
		const rounded = Math.round(amount / 10) * 10;
		return recurringKeys.has(`${key}|${rounded}`);
	}

	// Group by month → category
	type CategoryRow = {
		category: CategoryId;
		label: string;
		emoji: string;
		amount: number;
		count: number;
		isFixed: boolean;
	};

	const monthMap = new Map<
		string,
		{
			categories: Map<CategoryId, CategoryRow>;
			totalSpending: number;
			totalFixed: number;
			totalVariable: number;
			totalIncome: number;
		}
	>();

	// Sort months and ensure all months in range exist
	const allMonths: string[] = [];
	const cur = new Date(cutoff);
	const now = new Date();
	while (cur <= now) {
		allMonths.push(cur.toISOString().slice(0, 7));
		cur.setMonth(cur.getMonth() + 1);
	}
	for (const m of allMonths) {
		monthMap.set(m, {
			categories: new Map(),
			totalSpending: 0,
			totalFixed: 0,
			totalVariable: 0,
			totalIncome: 0
		});
	}

	for (const tx of txs) {
		if (!monthMap.has(tx.month)) continue;
		const monthData = monthMap.get(tx.month)!;

		const classified = categorizeTransaction(tx.description, tx.typeText, tx.amount, merchantMappingCache);

		// Recurrence check can promote to fixed
		const isFixed =
			classified.isFixed || isRecurring(tx.description, tx.amount);

		const absAmount = Math.abs(tx.amount);
		const isSpending = tx.amount < 0;
		const isIncome = tx.amount > 0;

		if (isIncome) {
			monthData.totalIncome += absAmount;
		}

		// Only aggregate outgoing (spending) into categories
		if (isSpending) {
			monthData.totalSpending += absAmount;
			if (isFixed) monthData.totalFixed += absAmount;
			else monthData.totalVariable += absAmount;

			const catId = classified.category;
			const existing = monthData.categories.get(catId);
			if (existing) {
				existing.amount += absAmount;
				existing.count += 1;
			} else {
				monthData.categories.set(catId, {
					category: catId,
					label: classified.label,
					emoji: classified.emoji,
					amount: absAmount,
					count: 1,
					isFixed
				});
			}
		}
	}

	const months = allMonths.map((month) => {
		const d = monthMap.get(month)!;
		const categories = Array.from(d.categories.values()).sort((a, b) => b.amount - a.amount);
		return {
			month,
			categories,
			totalSpending: Math.round(d.totalSpending),
			totalFixed: Math.round(d.totalFixed),
			totalVariable: Math.round(d.totalVariable),
			totalIncome: Math.round(d.totalIncome)
		};
	});

	// Which categories actually have data (for legend)
	const seenCategories = new Set<CategoryId>();
	for (const m of months) for (const c of m.categories) seenCategories.add(c.category);
	const allCategories = Object.values(CATEGORIES).filter((c) => seenCategories.has(c.id));

	return json({ months, allCategories });
};
