import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes, categorizedEvents, sensorEvents } from '$lib/db/schema';
import { eq, and, desc, ilike, or, sql } from 'drizzle-orm';
import { ensureCategorizedEventsForRange } from '$lib/server/integrations/categorized-events';

/**
 * GET /api/tema/[id]/transactions
 *
 * Query params:
 *   from        YYYY-MM-DD  (default: trip startDate)
 *   to          YYYY-MM-DD  (default: trip endDate + 1 day)
 *   accountId   string      optional account filter
 *   search      string      optional free-text search on description/typeText
 *   limit       number      default 200
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	const userId = locals.userId;

	// Verify the theme belongs to this user and get trip dates as fallback
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, userId)),
		columns: { tripProfile: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const profile = (theme.tripProfile ?? {}) as {
		startDate?: string;
		endDate?: string;
	};

	const fromParam = url.searchParams.get('from') ?? profile.startDate;
	const toParam = url.searchParams.get('to') ?? profile.endDate;
	const accountId = url.searchParams.get('accountId') ?? undefined;
	const search = url.searchParams.get('search')?.trim() ?? '';
	const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '200', 10), 500);

	if (!fromParam || !toParam) {
		return json({ error: 'Mangler fra/til-dato' }, { status: 400 });
	}

	const from = new Date(fromParam + 'T00:00:00Z');
	const to = new Date(toParam + 'T23:59:59Z');

	// Ensure categorized events exist for the range
	await ensureCategorizedEventsForRange({ userId, from, to });

	// Build where conditions
	const conditions = [
		eq(categorizedEvents.userId, userId),
		sql`${categorizedEvents.timestamp} >= ${from.toISOString()}`,
		sql`${categorizedEvents.timestamp} <= ${to.toISOString()}`
	];
	if (accountId) conditions.push(eq(categorizedEvents.accountId, accountId));
	if (search) {
		conditions.push(
			or(
				ilike(categorizedEvents.description, `%${search}%`),
				ilike(categorizedEvents.typeText, `%${search}%`),
				ilike(categorizedEvents.resolvedLabel, `%${search}%`)
			)!
		);
	}

	const rows = await db
		.select({
			id: categorizedEvents.sensorEventId,
			timestamp: categorizedEvents.timestamp,
			accountId: categorizedEvents.accountId,
			amount: categorizedEvents.amount,
			description: categorizedEvents.description,
			typeText: categorizedEvents.typeText,
			category: categorizedEvents.resolvedCategory,
			label: categorizedEvents.resolvedLabel,
			emoji: categorizedEvents.resolvedEmoji
		})
		.from(categorizedEvents)
		.where(and(...conditions))
		.orderBy(desc(categorizedEvents.timestamp))
		.limit(limit);

	// Fetch accounts for the selector
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

	const transactions = rows.map((r) => ({
		id: r.id,
		date: (r.timestamp as Date).toISOString().slice(0, 10),
		accountId: r.accountId,
		amount: Number(r.amount) || 0,
		description: r.description ?? r.typeText ?? '',
		category: r.category,
		label: r.label,
		emoji: r.emoji
	}));

	const totalSpent = transactions
		.filter((t) => t.amount < 0)
		.reduce((s, t) => s + Math.abs(t.amount), 0);

	return json({ transactions, accounts, totalSpent });
};
