import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { domainSignals } from '$lib/db/schema';
import { and, desc, eq, gte, sql } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '30', 10);
	const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 30, 1), 200);
	const signalType = (url.searchParams.get('signalType') ?? '').trim();
	const hoursRaw = Number.parseInt(url.searchParams.get('hours') ?? '0', 10);
	const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? Math.min(hoursRaw, 24 * 30) : 0;

	const since = hours > 0 ? new Date(Date.now() - hours * 60 * 60 * 1000) : null;

	const whereClause = and(
		eq(domainSignals.userId, userId),
		signalType ? eq(domainSignals.signalType, signalType) : undefined,
		since ? gte(domainSignals.observedAt, since) : undefined
	);

	const rows = await db.query.domainSignals.findMany({
		where: whereClause,
		orderBy: [desc(domainSignals.observedAt)],
		limit
	});

	const summaryRows = await db
		.select({
			signalType: domainSignals.signalType,
			count: sql<number>`count(*)::int`,
			latestObservedAt: sql<Date>`max(${domainSignals.observedAt})`
		})
		.from(domainSignals)
		.where(whereClause)
		.groupBy(domainSignals.signalType)
		.orderBy(sql`count(*) desc`, sql`max(${domainSignals.observedAt}) desc`);

	return json({
		count: rows.length,
		limit,
		signalType: signalType || null,
		hours: hours || null,
		summary: summaryRows.map((row) => ({
			signalType: row.signalType,
			count: row.count,
			latestObservedAt: row.latestObservedAt instanceof Date ? row.latestObservedAt.toISOString() : null
		})),
		signals: rows.map((row) => ({
			id: row.id,
			signalType: row.signalType,
			ownerDomain: row.ownerDomain,
			valueNumber: row.valueNumber !== null ? Number(row.valueNumber) : null,
			valueText: row.valueText,
			valueBool: row.valueBool,
			severity: row.severity,
			confidence: row.confidence !== null ? Number(row.confidence) : null,
			windowStart: row.windowStart?.toISOString() ?? null,
			windowEnd: row.windowEnd?.toISOString() ?? null,
			observedAt: row.observedAt?.toISOString() ?? null,
			context: (row.context ?? {}) as Record<string, unknown>
		}))
	});
};
