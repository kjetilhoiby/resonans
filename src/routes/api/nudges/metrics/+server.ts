import { and, eq, gte, sql } from 'drizzle-orm';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { nudgeEvents } from '$lib/db/schema';

function toMs(value: Date | string | null | undefined) {
	if (!value) return null;
	const ts = value instanceof Date ? value.getTime() : new Date(value).getTime();
	return Number.isFinite(ts) ? ts : null;
}

function durationMinutes(from: Date | string | null | undefined, to: Date | string | null | undefined) {
	const start = toMs(from);
	const end = toMs(to);
	if (start === null || end === null || end < start) return null;
	return (end - start) / 60000;
}

function safeRate(numerator: number, denominator: number) {
	if (denominator <= 0) return null;
	return Number(((numerator / denominator) * 100).toFixed(1));
}

function summarizeDurations(values: Array<number | null>) {
	const clean = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
	if (clean.length === 0) return { count: 0, avgMinutes: null };
	const sum = clean.reduce((acc, value) => acc + value, 0);
	return {
		count: clean.length,
		avgMinutes: Number((sum / clean.length).toFixed(1))
	};
}

export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const days = Math.max(1, Math.min(90, Number.parseInt(url.searchParams.get('days') || '30', 10) || 30));
	const since = new Date();
	since.setDate(since.getDate() - days);

	try {
		const [rows, totals] = await Promise.all([
			db.query.nudgeEvents.findMany({
				where: and(eq(nudgeEvents.userId, userId), gte(nudgeEvents.createdAt, since)),
				orderBy: (n, { desc: orderDesc }) => [orderDesc(n.createdAt)],
				limit: 200
			}),
			db
				.select({
					sent: sql<number>`count(*) filter (where ${nudgeEvents.sentAt} is not null)::int`,
					opened: sql<number>`count(*) filter (where ${nudgeEvents.openedAt} is not null)::int`,
					started: sql<number>`count(*) filter (where ${nudgeEvents.flowStartedAt} is not null)::int`,
					completed: sql<number>`count(*) filter (where ${nudgeEvents.flowCompletedAt} is not null)::int`
				})
				.from(nudgeEvents)
				.where(and(eq(nudgeEvents.userId, userId), gte(nudgeEvents.createdAt, since)))
		]);

		const aggregate = totals[0] ?? { sent: 0, opened: 0, started: 0, completed: 0 };
		const conversion = {
			openRatePercent: safeRate(aggregate.opened, aggregate.sent),
			startRateFromOpenedPercent: safeRate(aggregate.started, aggregate.opened),
			completeRateFromStartedPercent: safeRate(aggregate.completed, aggregate.started),
			completeRateFromSentPercent: safeRate(aggregate.completed, aggregate.sent)
		};

		const timing = {
			sentToOpened: summarizeDurations(rows.map((row) => durationMinutes(row.sentAt, row.openedAt))),
			openedToStarted: summarizeDurations(rows.map((row) => durationMinutes(row.openedAt, row.flowStartedAt))),
			startedToCompleted: summarizeDurations(rows.map((row) => durationMinutes(row.flowStartedAt, row.flowCompletedAt))),
			sentToCompleted: summarizeDurations(rows.map((row) => durationMinutes(row.sentAt, row.flowCompletedAt)))
		};

		return json({
			days,
			since: since.toISOString(),
			totals: aggregate,
			conversion,
			timing,
			recent: rows
		});
	} catch (error) {
		return json({
			days,
			since: since.toISOString(),
			totals: { sent: 0, opened: 0, started: 0, completed: 0 },
			conversion: {
				openRatePercent: null,
				startRateFromOpenedPercent: null,
				completeRateFromStartedPercent: null,
				completeRateFromSentPercent: null
			},
			timing: {
				sentToOpened: { count: 0, avgMinutes: null },
				openedToStarted: { count: 0, avgMinutes: null },
				startedToCompleted: { count: 0, avgMinutes: null },
				sentToCompleted: { count: 0, avgMinutes: null }
			},
			recent: [],
			warning: error instanceof Error ? error.message : 'nudge_events table not available'
		});
	}
};
