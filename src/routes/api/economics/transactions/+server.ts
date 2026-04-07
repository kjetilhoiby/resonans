import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, asc, sql } from 'drizzle-orm';
import { categorizeTransaction } from '$lib/server/integrations/transaction-categories';
import { loadMerchantMappings } from '$lib/server/integrations/spending-analyzer';
import { loadClassificationOverrides, loadTransactionMatchingRules } from '$lib/server/classification-overrides';
import type { RequestHandler } from './$types';

/**
 * GET /api/economics/transactions
 * Supports two modes:
 *   ?accountId=xxx&month=2025-01&category=dagligvare   (spending drill-down)
 *   ?accountId=xxx&fromDate=2025-01-10&toDate=2025-01-25  (balance chart brush)
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const accountId = url.searchParams.get('accountId');
	const accountIdsParam = url.searchParams.get('accountIds');
	const month = url.searchParams.get('month');
	const categoryFilter = url.searchParams.get('category');
	const subcategoryFilter = url.searchParams.get('subcategory');
	const fromDateParam = url.searchParams.get('fromDate');
	const toDateParam = url.searchParams.get('toDate');

	let from: Date;
	let to: Date;

	if (fromDateParam && toDateParam) {
		from = new Date(fromDateParam);
		to = new Date(toDateParam);
		to.setDate(to.getDate() + 1); // inclusive end
	} else if (month) {
		const [year, mo] = month.split('-').map(Number);
		from = new Date(year, mo - 1, 1);
		to = new Date(year, mo, 1);
	} else {
		return json({ error: 'Missing month or fromDate+toDate' }, { status: 400 });
	}

	const requestedAccountIds = accountIdsParam
		? accountIdsParam.split(',').map((v) => v.trim()).filter(Boolean)
		: [];

	if (requestedAccountIds.length === 0 && accountId) {
		requestedAccountIds.push(accountId);
	}

	const where = and(
		eq(sensorEvents.userId, userId),
		eq(sensorEvents.dataType, 'bank_transaction'),
		sql`timestamp >= ${from.toISOString()}`,
		sql`timestamp < ${to.toISOString()}`,
		...(requestedAccountIds.length > 0
			? [
				sql`data->>'accountId' IN (${sql.join(
					requestedAccountIds.map((id) => sql`${id}`),
					sql`, `
				)})`
			]
			: [])
	);

	const [rows, merchantMappingCache, transactionOverrideCache, transactionRules] = await Promise.all([
		db
			.select({
				timestamp: sensorEvents.timestamp,
				amount: sql<number>`(data->>'amount')::numeric`,
				description: sql<string>`data->>'description'`,
				typeText: sql<string>`data->>'category'`,
				accountId: sql<string>`data->>'accountId'`,
				transactionId: sql<string>`metadata->>'transactionId'`
			})
			.from(sensorEvents)
			.where(where)
			.orderBy(asc(sensorEvents.timestamp)),
		loadMerchantMappings(userId),
		loadClassificationOverrides(userId, 'transaction'),
		loadTransactionMatchingRules()
	]);

	const transactions = rows
		.map((r) => {
			const amount = Number(r.amount) || 0;
			const cat = categorizeTransaction(r.description, r.typeText, amount, merchantMappingCache, transactionOverrideCache, transactionRules);
			return {
				transactionId: r.transactionId,
				accountId: r.accountId,
				date: r.timestamp.toISOString().split('T')[0],
				description: r.description ?? '',
				amount,
				category: cat.category,
				subcategory: cat.subcategory ?? null,
				label: cat.label,
				emoji: cat.emoji,
				isFixed: cat.isFixed
			};
		})
		.filter((t) => (!categoryFilter || t.category === categoryFilter))
		.filter((t) => (!subcategoryFilter || t.subcategory === subcategoryFilter))
		.sort((a, b) => {
			if (a.date > b.date) return -1;
			if (a.date < b.date) return 1;
			return a.amount - b.amount;
		});

	return json(transactions);
};
