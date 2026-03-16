import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, asc, sql } from 'drizzle-orm';
import { DEFAULT_USER_ID } from '$lib/server/users';
import { categorizeTransaction } from '$lib/server/integrations/transaction-categories';
import { loadMerchantMappings } from '$lib/server/integrations/spending-analyzer';
import type { RequestHandler } from './$types';

/**
 * GET /api/economics/transactions
 * Supports two modes:
 *   ?accountId=xxx&month=2025-01&category=dagligvare   (spending drill-down)
 *   ?accountId=xxx&fromDate=2025-01-10&toDate=2025-01-25  (balance chart brush)
 */
export const GET: RequestHandler = async ({ url }) => {
	const userId = DEFAULT_USER_ID;
	const accountId = url.searchParams.get('accountId');
	const month = url.searchParams.get('month');
	const categoryFilter = url.searchParams.get('category');
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

	const where = accountId
		? and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'bank_transaction'),
				sql`data->>'accountId' = ${accountId}`,
				sql`timestamp >= ${from.toISOString()}`,
				sql`timestamp < ${to.toISOString()}`
			)
		: and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'bank_transaction'),
				sql`timestamp >= ${from.toISOString()}`,
				sql`timestamp < ${to.toISOString()}`
			);

	const [rows, merchantMappingCache] = await Promise.all([
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
		loadMerchantMappings(userId)
	]);

	const transactions = rows
		.map((r) => {
			const amount = Number(r.amount) || 0;
			const cat = categorizeTransaction(r.description, r.typeText, amount, merchantMappingCache);
			return {
				transactionId: r.transactionId,
				date: r.timestamp.toISOString().split('T')[0],
				description: r.description ?? '',
				amount,
				category: cat.category,
				label: cat.label,
				emoji: cat.emoji,
				isFixed: cat.isFixed
			};
		})
		.filter((t) => !categoryFilter || t.category === categoryFilter)
		.sort((a, b) => a.amount - b.amount); // most negative first (largest expense)

	return json(transactions);
};
