import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { requireAdmin } from '$lib/server/admin-auth';
import { canonicalBankTransactions } from '$lib/db/schema';
import { and, eq, desc, sql } from 'drizzle-orm';

/**
 * GET /api/admin/salary-profile/account-transactions?accountId=xxx
 *
 * Returns recent income transactions (≥ 10 000 kr) for the given account.
 * Used by the manual salary-profile setup UI to let the user pick a
 * representative transaction when automated detection fails.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals.userId);

	const accountId = url.searchParams.get('accountId');
	if (!accountId) return json({ error: 'Missing accountId' }, { status: 400 });

	const rows = await db
		.select({
			id: canonicalBankTransactions.id,
			canonicalDate: canonicalBankTransactions.canonicalDate,
			amount: canonicalBankTransactions.amount,
			description: sql<string>`COALESCE(${canonicalBankTransactions.descriptionDisplay}, ${canonicalBankTransactions.merchantKey}, '')`
		})
		.from(canonicalBankTransactions)
		.where(
			and(
				eq(canonicalBankTransactions.userId, locals.userId),
				eq(canonicalBankTransactions.accountId, accountId),
				eq(canonicalBankTransactions.isActive, true),
				sql`${canonicalBankTransactions.amount} >= 10000`
			)
		)
		.orderBy(desc(canonicalBankTransactions.canonicalDate))
		.limit(24);

	return json(rows);
};
