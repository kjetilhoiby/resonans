import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { requireAdmin } from '$lib/server/admin-auth';
import { loadSalaryProfile, isPaycheck } from '$lib/server/integrations/salary-profile';
import { canonicalBankTransactions } from '$lib/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { env } from '$env/dynamic/private';

/**
 * POST /api/admin/salary-profile/backfill
 * Tags all canonical_bank_transactions for this user with paycheck_type
 * based on the current active salary profile.
 *
 * Query param: ?dryRun=true  → returns counts without writing
 */
export const POST: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals.userId);

	const dryRun = url.searchParams.get('dryRun') === 'true';

	const profile = await loadSalaryProfile(locals.userId);
	if (!profile) {
		return json(
			{ error: 'Ingen aktiv lønnsprofile. Bygg profil først.' },
			{ status: 422 }
		);
	}

	// Fetch all income-sized active canonical transactions for this user
	const candidates = await db
		.select({
			id: canonicalBankTransactions.id,
			amount: canonicalBankTransactions.amount,
			description: sql<string>`COALESCE(${canonicalBankTransactions.descriptionDisplay}, ${canonicalBankTransactions.merchantKey}, '')`,
			canonicalDate: canonicalBankTransactions.canonicalDate
		})
		.from(canonicalBankTransactions)
		.where(
			and(
				eq(canonicalBankTransactions.userId, locals.userId),
				eq(canonicalBankTransactions.isActive, true),
				gte(canonicalBankTransactions.amount, '10000')
			)
		);

	const updates: { id: string; paycheckType: 'main' | 'supplementary' }[] = [];
	const clears: string[] = [];

	for (const row of candidates) {
		const result = isPaycheck(
			{ amount: Number(row.amount), description: row.description, date: row.canonicalDate },
			profile
		);
		if (result) {
			updates.push({ id: row.id, paycheckType: result });
		} else {
			// Clear any stale tag on this row
			clears.push(row.id);
		}
	}

	if (dryRun) {
		const mainCount = updates.filter((u) => u.paycheckType === 'main').length;
		const supplementaryCount = updates.filter((u) => u.paycheckType === 'supplementary').length;
		return json({
			dryRun: true,
			wouldTag: { main: mainCount, supplementary: supplementaryCount },
			wouldClear: clears.length
		});
	}

	// Apply in batches using raw SQL for efficiency
	const pgClient = postgres(env.DATABASE_URL, { max: 1 });
	try {
		let taggedMain = 0;
		let taggedSupplementary = 0;

		const mainIds = updates.filter((u) => u.paycheckType === 'main').map((u) => u.id);
		const suppIds = updates.filter((u) => u.paycheckType === 'supplementary').map((u) => u.id);

		if (mainIds.length > 0) {
			await pgClient.unsafe(
				`UPDATE canonical_bank_transactions SET paycheck_type = 'main' WHERE id = ANY($1)`,
				[mainIds]
			);
			taggedMain = mainIds.length;
		}
		if (suppIds.length > 0) {
			await pgClient.unsafe(
				`UPDATE canonical_bank_transactions SET paycheck_type = 'supplementary' WHERE id = ANY($1)`,
				[suppIds]
			);
			taggedSupplementary = suppIds.length;
		}

		// Clear stale tags on non-matching rows (only if they currently have a tag)
		if (clears.length > 0) {
			await pgClient.unsafe(
				`UPDATE canonical_bank_transactions SET paycheck_type = NULL WHERE id = ANY($1) AND paycheck_type IS NOT NULL`,
				[clears]
			);
		}

		return json({
			success: true,
			tagged: { main: taggedMain, supplementary: taggedSupplementary },
			cleared: clears.length
		});
	} finally {
		await pgClient.end();
	}
};
