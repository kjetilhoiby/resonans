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

function percentile(values: number[], p: number) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const index = (sorted.length - 1) * p;
	const lower = Math.floor(index);
	const upper = Math.ceil(index);
	if (lower === upper) return sorted[lower] ?? null;
	const weight = index - lower;
	const lowerValue = sorted[lower] ?? 0;
	const upperValue = sorted[upper] ?? 0;
	return lowerValue + (upperValue - lowerValue) * weight;
}

function summarizeDurations(values: Array<number | null>) {
	const clean = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
	if (clean.length === 0) return { count: 0, avgMinutes: null, medianMinutes: null, p90Minutes: null };
	const sum = clean.reduce((acc, value) => acc + value, 0);
	const med = percentile(clean, 0.5);
	const p90 = percentile(clean, 0.9);
	return {
		count: clean.length,
		avgMinutes: Number((sum / clean.length).toFixed(1)),
		medianMinutes: med === null ? null : Number(med.toFixed(1)),
		p90Minutes: p90 === null ? null : Number(p90.toFixed(1))
	};
}

function summarizeMetrics(rows: Array<typeof nudgeEvents.$inferSelect>) {
	const totals = {
		sent: rows.filter((r) => r.sentAt).length,
		opened: rows.filter((r) => r.openedAt).length,
		started: rows.filter((r) => r.flowStartedAt).length,
		completed: rows.filter((r) => r.flowCompletedAt).length
	};

	const conversion = {
		openRatePercent: safeRate(totals.opened, totals.sent),
		startRateFromOpenedPercent: safeRate(totals.started, totals.opened),
		completeRateFromStartedPercent: safeRate(totals.completed, totals.started),
		completeRateFromSentPercent: safeRate(totals.completed, totals.sent)
	};

	const timing = {
		sentToOpened: summarizeDurations(rows.map((row) => durationMinutes(row.sentAt, row.openedAt))),
		openedToStarted: summarizeDurations(rows.map((row) => durationMinutes(row.openedAt, row.flowStartedAt))),
		startedToCompleted: summarizeDurations(rows.map((row) => durationMinutes(row.flowStartedAt, row.flowCompletedAt))),
		sentToCompleted: summarizeDurations(rows.map((row) => durationMinutes(row.sentAt, row.flowCompletedAt)))
	};

	return { totals, conversion, timing };
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
		const overall = summarizeMetrics(rows);

		const byTypeRows = rows.reduce<Record<string, Array<typeof nudgeEvents.$inferSelect>>>((acc, row) => {
			const key = row.nudgeType || 'unknown';
			if (!acc[key]) acc[key] = [];
			acc[key].push(row);
			return acc;
		}, {});

		const byType = Object.fromEntries(
			Object.entries(byTypeRows).map(([type, typeRows]) => [
				type,
				{
					label: type,
					...summarizeMetrics(typeRows)
				}
			])
		);

		return json({
			days,
			since: since.toISOString(),
			totals: {
				sent: aggregate.sent,
				opened: aggregate.opened,
				started: aggregate.started,
				completed: aggregate.completed
			},
			conversion: overall.conversion,
			timing: overall.timing,
			byType,
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
				sentToOpened: { count: 0, avgMinutes: null, medianMinutes: null, p90Minutes: null },
				openedToStarted: { count: 0, avgMinutes: null, medianMinutes: null, p90Minutes: null },
				startedToCompleted: { count: 0, avgMinutes: null, medianMinutes: null, p90Minutes: null },
				sentToCompleted: { count: 0, avgMinutes: null, medianMinutes: null, p90Minutes: null }
			},
			byType: {},
			recent: [],
			warning: error instanceof Error ? error.message : 'nudge_events table not available'
		});
	}
};
