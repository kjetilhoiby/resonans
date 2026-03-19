import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { DEFAULT_USER_ID } from '$lib/server/users';
import { categorizeTransaction } from '$lib/server/integrations/transaction-categories';
import { loadMerchantMappings } from '$lib/server/integrations/spending-analyzer';
import type { RequestHandler } from './$types';

/**
 * GET /api/economics/cumulative-spending
 * Returns daily cumulative spending for a specific category within a date range.
 * 
 * Query params:
 *   - accountId: filter by account
 *   - category: filter by category (dagligvare, transport, mat, etc.)
 *   - fromDate: start date (YYYY-MM-DD)
 *   - toDate: end date (YYYY-MM-DD)
 *   - month: alternatively, specify a month (YYYY-MM) instead of fromDate+toDate
 */
export const GET: RequestHandler = async ({ url }) => {
	const userId = DEFAULT_USER_ID;
	const accountId = url.searchParams.get('accountId');
	const categoryFilter = url.searchParams.get('category');
	const fromDateParam = url.searchParams.get('fromDate');
	const toDateParam = url.searchParams.get('toDate');
	const monthParam = url.searchParams.get('month');

	if (!categoryFilter) {
		return json({ error: 'Missing category parameter' }, { status: 400 });
	}

	let from: Date;
	let to: Date;

	if (monthParam) {
		const [year, mo] = monthParam.split('-').map(Number);
		from = new Date(year, mo - 1, 1);
		to = new Date(year, mo, 1);
	} else if (fromDateParam && toDateParam) {
		from = new Date(fromDateParam);
		to = new Date(toDateParam);
		to.setDate(to.getDate() + 1); // inclusive end
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
			})
			.from(sensorEvents)
			.where(where),
		loadMerchantMappings(userId)
	]);

	// Filter and categorize transactions
	const transactions = rows
		.map((r) => {
			const amount = Number(r.amount) || 0;
			const cat = categorizeTransaction(r.description, r.typeText, amount, merchantMappingCache);
			return {
				date: r.timestamp.toISOString().split('T')[0],
				amount,
				category: cat.category,
			};
		})
		.filter((t) => t.category === categoryFilter && t.amount < 0); // Only expenses

	// Build daily cumulative spending
	const dayMap = new Map<string, number>();
	
	for (const tx of transactions) {
		const current = dayMap.get(tx.date) || 0;
		dayMap.set(tx.date, current + Math.abs(tx.amount));
	}

	// Create array of all days in range with cumulative values
	const result: Array<{ date: string; cumulative: number; dailySpent: number }> = [];
	let cumulative = 0;

	const currentDate = new Date(from);
	while (currentDate < to) {
		const dateStr = currentDate.toISOString().split('T')[0];
		const dailySpent = dayMap.get(dateStr) || 0;
		cumulative += dailySpent;
		
		result.push({
			date: dateStr,
			cumulative,
			dailySpent
		});

		currentDate.setDate(currentDate.getDate() + 1);
	}

	return json({
		category: categoryFilter,
		fromDate: from.toISOString().split('T')[0],
		toDate: to.toISOString().split('T')[0],
		data: result,
		total: cumulative
	});
};
