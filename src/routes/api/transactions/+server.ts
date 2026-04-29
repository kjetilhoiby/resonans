import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { canonicalBankTransactions } from '$lib/db/schema';
import { eq, and, desc, asc, sql } from 'drizzle-orm';
import { categorizeTransaction } from '$lib/server/integrations/transaction-categories';
import { loadMerchantMappings } from '$lib/server/integrations/spending-analyzer';
import { loadClassificationOverrides, loadTransactionMatchingRules } from '$lib/server/classification-overrides';

/**
 * Unified transaction API - reads from canonical_bank_transactions (properly deduplicated).
 * Categorisation is applied in-memory after fetching, same as economics-dashboard.ts.
 *
 * Query params:
 *   from         YYYY-MM-DD  (required)
 *   to           YYYY-MM-DD  (required)
 *   accountIds   comma-separated account IDs (optional, defaults to all)
 *   category     category filter (optional, applied in-memory)
 *   subcategory  subcategory filter (optional, applied in-memory)
 *   search       free-text search on description (optional, applied in-memory)
 *   spendingOnly boolean - only negative amounts (optional)
 *   limit        max results (default 500, max 1000)
 *   sortBy       'date' or 'amount' (default 'date')
 *   sortOrder    'asc' or 'desc' (default 'desc')
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;

	// Parse required date range
	const fromParam = url.searchParams.get('from');
	const toParam = url.searchParams.get('to');
	if (!fromParam || !toParam) {
		return json({ error: 'Missing from/to parameters' }, { status: 400 });
	}

	// Parse optional filters
	const accountIdsParam = url.searchParams.get('accountIds');
	const accountIds = accountIdsParam
		? accountIdsParam.split(',').map((v) => v.trim()).filter(Boolean)
		: [];
	const category = url.searchParams.get('category')?.trim() || null;
	const subcategory = url.searchParams.get('subcategory')?.trim() || null;
	const search = url.searchParams.get('search')?.trim()?.toLowerCase() || null;
	const spendingOnly = url.searchParams.get('spendingOnly') === 'true';
	const limit = Math.min(
		parseInt(url.searchParams.get('limit') ?? '500', 10),
		1000
	);
	const sortBy = url.searchParams.get('sortBy') === 'amount' ? 'amount' : 'date';
	const sortOrder = url.searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';

	// Load classification caches in parallel
	const [merchantMappings, overrides, rules] = await Promise.all([
		loadMerchantMappings(userId),
		loadClassificationOverrides(userId, 'transaction'),
		loadTransactionMatchingRules()
	]);

	// Build SQL WHERE conditions
	const conditions = [
		eq(canonicalBankTransactions.userId, userId),
		eq(canonicalBankTransactions.isActive, true),
		sql`${canonicalBankTransactions.canonicalDate} >= ${fromParam}::date`,
		sql`${canonicalBankTransactions.canonicalDate} <= ${toParam}::date`
	];

	if (accountIds.length > 0) {
		conditions.push(
			sql`${canonicalBankTransactions.accountId} IN (${sql.join(
				accountIds.map((id) => sql`${id}`),
				sql`, `
			)})`
		);
	}

	if (spendingOnly) {
		conditions.push(sql`${canonicalBankTransactions.amount}::numeric < 0`);
	}

	const orderByClause =
		sortBy === 'amount'
			? sortOrder === 'asc'
				? asc(canonicalBankTransactions.amount)
				: desc(canonicalBankTransactions.amount)
			: sortOrder === 'asc'
				? asc(canonicalBankTransactions.canonicalDate)
				: desc(canonicalBankTransactions.canonicalDate);

	const rows = await db
		.select({
			id: canonicalBankTransactions.id,
			date: canonicalBankTransactions.canonicalDate,
			accountId: canonicalBankTransactions.accountId,
			amount: canonicalBankTransactions.amount,
			description: canonicalBankTransactions.descriptionDisplay,
			merchantKey: canonicalBankTransactions.merchantKey,
			latestBookingStatus: canonicalBankTransactions.latestBookingStatus
		})
		.from(canonicalBankTransactions)
		.where(and(...conditions))
		.orderBy(orderByClause)
		.limit(spendingOnly || (!category && !subcategory && !search) ? limit : limit * 3);

	// Apply categorisation and in-memory filters
	let transactions = rows.map((r) => {
		const description = (r.description ?? r.merchantKey ?? '').trim();
		const amount = Number(r.amount) || 0;
		const classified = categorizeTransaction(
			description,
			null,
			amount,
			merchantMappings,
			overrides,
			rules
		);
		return {
			id: r.id,
			date: r.date as string,
			accountId: r.accountId,
			amount,
			description,
			typeText: null as string | null,
			category: classified.category,
			subcategory: classified.subcategory ?? null,
			label: classified.label,
			emoji: classified.emoji,
			isFixed: classified.isFixed
		};
	});

	if (category) {
		transactions = transactions.filter((t) => t.category === category);
	}
	if (subcategory) {
		transactions = transactions.filter((t) => t.subcategory === subcategory);
	}
	if (search) {
		transactions = transactions.filter(
			(t) => t.description.toLowerCase().includes(search) || t.label.toLowerCase().includes(search)
		);
	}

	// Apply final limit after in-memory filters
	transactions = transactions.slice(0, limit);

	const totalSpent = transactions
		.filter((t) => t.amount < 0)
		.reduce((s, t) => s + Math.abs(t.amount), 0);

	return json({ transactions, totalSpent });
};

