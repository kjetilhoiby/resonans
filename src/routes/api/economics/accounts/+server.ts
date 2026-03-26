import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, desc, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * GET /api/economics/accounts
 * Returns list of bank accounts with latest balance from bank_balance events
 */
export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;

	// Get the latest bank_balance event per accountId
	const rows = await db
		.select({
			accountId: sql<string>`data->>'accountId'`,
			accountName: sql<string>`data->>'accountName'`,
			accountType: sql<string>`data->>'accountType'`,
			accountNumber: sql<string>`data->>'accountNumber'`,
			balance: sql<number>`(data->>'balance')::numeric`,
			availableBalance: sql<number>`(data->>'availableBalance')::numeric`,
			currency: sql<string>`data->>'currency'`,
			timestamp: sensorEvents.timestamp
		})
		.from(sensorEvents)
		.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'bank_balance')))
		.orderBy(desc(sensorEvents.timestamp));

	// Dedup: keep only latest per accountId
	const seen = new Set<string>();
	const accounts = rows
		.filter((r) => {
			if (!r.accountId || seen.has(r.accountId)) return false;
			seen.add(r.accountId);
			return true;
		})
		.sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));

	return json(accounts);
};
