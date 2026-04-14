import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

/**
 * GET /api/accounts
 * Returns all bank accounts for the current user.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;

	const accountRows = await db
		.select({
			accountId: sql<string>`data->>'accountId'`,
			accountName: sql<string>`data->>'accountName'`,
			timestamp: sensorEvents.timestamp
		})
		.from(sensorEvents)
		.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'bank_balance')))
		.orderBy(desc(sensorEvents.timestamp));

	const seenAccounts = new Set<string>();
	const accounts = accountRows
		.filter((r) => {
			if (!r.accountId || seenAccounts.has(r.accountId)) return false;
			seenAccounts.add(r.accountId);
			return true;
		})
		.map((a) => ({ id: a.accountId, name: a.accountName }));

	return json({ accounts });
};
