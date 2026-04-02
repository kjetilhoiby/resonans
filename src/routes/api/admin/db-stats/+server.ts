import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { requireAdmin } from '$lib/server/admin-auth';
import { sensorEvents } from '$lib/db/schema';
import { eq, sql } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	try {
		await requireAdmin(locals.userId);
		// Get balance snapshots grouped by account and source
		const balanceStats = await db.execute(sql`
			SELECT 
				data->>'accountId' as "accountId",
				metadata->>'source' as source,
				count(*)::int as count,
				min(timestamp::date)::text as "minDate",
				max(timestamp::date)::text as "maxDate"
			FROM sensor_events
			WHERE data_type = 'bank_balance'
			AND user_id = ${locals.userId}
			AND data->>'accountId' IS NOT NULL
			GROUP BY data->>'accountId', metadata->>'source'
		`);

		// Get transaction stats grouped by account and source
		const transactionStats = await db.execute(sql`
			SELECT 
				data->>'accountId' as "accountId",
				metadata->>'source' as source,
				count(*)::int as count,
				min(timestamp::date)::text as "minDate",
				max(timestamp::date)::text as "maxDate",
				sum((data->>'amount')::numeric)::float as "sumAmount"
			FROM sensor_events
			WHERE data_type = 'bank_transaction'
			AND user_id = ${locals.userId}
			AND data->>'accountId' IS NOT NULL
			GROUP BY data->>'accountId', metadata->>'source'
		`);

		// Get unique account IDs and their account numbers
		const accounts = await db.execute(sql`
			SELECT 
				data->>'accountId' as "accountId",
				data->>'accountNumber' as "accountNumber",
				min(timestamp)::text as "firstSeen",
				max(timestamp)::text as "lastSeen"
			FROM sensor_events
			WHERE data->>'accountId' IS NOT NULL
			AND user_id = ${locals.userId}
			GROUP BY data->>'accountId', data->>'accountNumber'
		`);

		return json({
			accounts,
			balanceSnapshots: balanceStats,
			transactions: transactionStats,
			summary: {
				totalBalanceSnapshots: Array.isArray(balanceStats) ? balanceStats.reduce((sum: number, s: any) => sum + (s.count || 0), 0) : 0,
				totalTransactions: Array.isArray(transactionStats) ? transactionStats.reduce((sum: number, s: any) => sum + (s.count || 0), 0) : 0,
				uniqueAccounts: Array.isArray(accounts) ? accounts.length : 0,
				sources: {
					balance: Array.isArray(balanceStats) ? [...new Set(balanceStats.map((s: any) => s.source).filter(Boolean))] : [],
					transaction: Array.isArray(transactionStats) ? [...new Set(transactionStats.map((s: any) => s.source).filter(Boolean))] : []
				}
			}
		});
	} catch (err) {
		console.error('db-stats error:', err);
		return json({ error: String(err) }, { status: 500 });
	}
};
