import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { categorizedEvents, sensorEvents } from '$lib/db/schema';
import { eq, and, desc, asc, ilike, or, sql } from 'drizzle-orm';
import { ensureCategorizedEventsForRange } from '$lib/server/integrations/categorized-events';

/**
 * Unified transaction API - the sole endpoint for querying transactions.
 * 
 * Always reads from categorized_events (materialized view) for consistency.
 * Auto-syncs the view if needed before querying.
 *
 * Query params:
 *   from         YYYY-MM-DD  (required)
 *   to           YYYY-MM-DD  (required)
 *   accountIds   comma-separated account IDs (optional, defaults to all)
 *   category     category filter (optional)
 *   subcategory  subcategory filter (optional)
 *   search       free-text search on description/typeText/label (optional)
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

	const from = new Date(fromParam + 'T00:00:00Z');
	const to = new Date(toParam + 'T23:59:59Z');

	// Parse optional filters
	const accountIdsParam = url.searchParams.get('accountIds');
	const accountIds = accountIdsParam
		? accountIdsParam.split(',').map((v) => v.trim()).filter(Boolean)
		: [];
	const category = url.searchParams.get('category')?.trim() || null;
	const subcategory = url.searchParams.get('subcategory')?.trim() || null;
	const search = url.searchParams.get('search')?.trim() || null;
	const spendingOnly = url.searchParams.get('spendingOnly') === 'true';
	const limit = Math.min(
		parseInt(url.searchParams.get('limit') ?? '500', 10),
		1000
	);
	const sortBy = url.searchParams.get('sortBy') === 'amount' ? 'amount' : 'date';
	const sortOrder = url.searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';

	// Ensure categorized events exist for this range
	await ensureCategorizedEventsForRange({ userId, from, to });

	// Build WHERE conditions
	const conditions = [
		eq(categorizedEvents.userId, userId),
		sql`${categorizedEvents.timestamp} >= ${from.toISOString()}`,
		sql`${categorizedEvents.timestamp} <= ${to.toISOString()}`
	];

	if (accountIds.length > 0) {
		conditions.push(
			sql`${categorizedEvents.accountId} IN (${sql.join(
				accountIds.map((id) => sql`${id}`),
				sql`, `
			)})`
		);
	}

	if (category) {
		conditions.push(eq(categorizedEvents.resolvedCategory, category));
	}

	if (subcategory) {
		conditions.push(eq(categorizedEvents.resolvedSubcategory, subcategory));
	}

	if (search) {
		conditions.push(
			or(
				ilike(categorizedEvents.description, `%${search}%`),
				ilike(categorizedEvents.typeText, `%${search}%`),
				ilike(categorizedEvents.resolvedLabel, `%${search}%`)
			)!
		);
	}

	if (spendingOnly) {
		conditions.push(sql`${categorizedEvents.amount}::numeric < 0`);
	}

	// Query transactions
	const orderByClause =
		sortBy === 'amount'
			? sortOrder === 'asc'
				? asc(categorizedEvents.amount)
				: desc(categorizedEvents.amount)
			: sortOrder === 'asc'
				? asc(categorizedEvents.timestamp)
				: desc(categorizedEvents.timestamp);

	const rows = await db
		.select({
			id: categorizedEvents.sensorEventId,
			timestamp: categorizedEvents.timestamp,
			accountId: categorizedEvents.accountId,
			amount: categorizedEvents.amount,
			description: categorizedEvents.description,
			typeText: categorizedEvents.typeText,
			category: categorizedEvents.resolvedCategory,
			subcategory: categorizedEvents.resolvedSubcategory,
			label: categorizedEvents.resolvedLabel,
			emoji: categorizedEvents.resolvedEmoji,
			isFixed: categorizedEvents.isFixed
		})
		.from(categorizedEvents)
		.where(and(...conditions))
		.orderBy(orderByClause)
		.limit(limit);

	const transactions = rows.map((r) => ({
		id: r.id,
		date: (r.timestamp as Date).toISOString().slice(0, 10),
		accountId: r.accountId,
		amount: Number(r.amount) || 0,
		description: r.description ?? r.typeText ?? '',
		typeText: r.typeText,
		category: r.category,
		subcategory: r.subcategory,
		label: r.label,
		emoji: r.emoji,
		isFixed: r.isFixed
	}));

	const totalSpent = transactions
		.filter((t) => t.amount < 0)
		.reduce((s, t) => s + Math.abs(t.amount), 0);

	return json({ transactions, totalSpent });
};
