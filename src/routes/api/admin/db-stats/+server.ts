import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { eq, sql } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
	try {
		// Get balance snapshots grouped by account and source
		const balanceStats = await db
			.select({
				accountId: sql<string>`data->>'accountId'`,
				source: sql<string>`metadata->>'source'`,
				count: sql<number>`count(*)::int`,
				minDate: sql<string>`min(timestamp::date)`,
				maxDate: sql<string>`max(timestamp::date)`,
				example: sql<any>`jsonb_build_object('accountNumber', data->>'accountNumber', 'balance', data->>'balance')`
			})
			.from(sensorEvents)
			.where(eq(sensorEvents.dataType, 'bank_balance'))
			.groupBy(sql`data->>'accountId'`, sql`metadata->>'source'`);

		// Get transaction stats grouped by account and source
		const transactionStats = await db
			.select({
				accountId: sql<string>`data->>'accountId'`,
				source: sql<string>`metadata->>'source'`,
				count: sql<number>`count(*)::int`,
				minDate: sql<string>`min(timestamp::date)`,
				maxDate: sql<string>`max(timestamp::date)`,
				sumAmount: sql<number>`sum((data->>'amount')::numeric)`
			})
			.from(sensorEvents)
			.where(eq(sensorEvents.dataType, 'bank_transaction'))
			.groupBy(sql`data->>'accountId'`, sql`metadata->>'source'`);

		// Get unique account IDs and their account numbers
		const accounts = await db
			.select({
				accountId: sql<string>`data->>'accountId'`,
				accountNumber: sql<string>`data->>'accountNumber'`,
				firstSeen: sql<string>`min(timestamp)`,
				lastSeen: sql<string>`max(timestamp)`
			})
			.from(sensorEvents)
			.where(sql`data->>'accountId' IS NOT NULL`)
			.groupBy(sql`data->>'accountId'`, sql`data->>'accountNumber'`);

		return json({
			accounts,
			balanceSnapshots: balanceStats,
			transactions: transactionStats,
			summary: {
				totalBalanceSnapshots: balanceStats.reduce((sum, s) => sum + s.count, 0),
				totalTransactions: transactionStats.reduce((sum, s) => sum + s.count, 0),
				uniqueAccounts: accounts.length,
				sources: {
					balance: [...new Set(balanceStats.map((s) => s.source))],
					transaction: [...new Set(transactionStats.map((s) => s.source))]
				}
			}
		});
	} catch (err) {
		console.error('db-stats error:', err);
		return json({ error: String(err) }, { status: 500 });
	}
};
