import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklistItems, checklists, goals, sensorEvents, workoutDailyAggregates } from '$lib/db/schema';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { getPlanArtifact } from '$lib/server/plan-artifacts';

function getIsoWeekInfo(now: Date = new Date()) {
	const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const year = d.getUTCFullYear();
	const yearStart = new Date(Date.UTC(year, 0, 1));
	const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	const week = String(weekNo).padStart(2, '0');

	const monday = new Date(d);
	monday.setUTCDate(d.getUTCDate() - 3);
	const sunday = new Date(monday);
	sunday.setUTCDate(monday.getUTCDate() + 6);

	return {
		year,
		week,
		weekNo,
		dashedKey: `${year}-W${week}`,
		compactKey: `${year}W${week}`,
		contextKey: `week:${year}-W${week}`,
		startDate: monday.toISOString().slice(0, 10),
		endDate: sunday.toISOString().slice(0, 10)
	};
}

function getIsoWeekInfoFromKey(weekKey: string) {
	const match = weekKey.match(/^(\d{4})-W(\d{2})$/);
	if (!match) return null;
	const year = Number.parseInt(match[1], 10);
	const week = Number.parseInt(match[2], 10);
	if (!Number.isFinite(year) || !Number.isFinite(week) || week < 1 || week > 53) return null;

	const jan4 = new Date(Date.UTC(year, 0, 4));
	const jan4Day = jan4.getUTCDay() || 7;
	const week1Monday = new Date(jan4);
	week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
	const monday = new Date(week1Monday);
	monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
	const resolved = getIsoWeekInfo(monday);
	return resolved.dashedKey === weekKey ? resolved : null;
}

function shiftWeek(info: ReturnType<typeof getIsoWeekInfo>, delta: number) {
	const monday = new Date(`${info.startDate}T00:00:00.000Z`);
	monday.setUTCDate(monday.getUTCDate() + delta * 7);
	return getIsoWeekInfo(monday);
}

export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const requestedWeek = url.searchParams.get('week');
	const currentWeek = requestedWeek
		? (getIsoWeekInfoFromKey(requestedWeek) ?? getIsoWeekInfo())
		: getIsoWeekInfo();
	const prevWeek = shiftWeek(currentWeek, -1);

	const prevStart = new Date(`${prevWeek.startDate}T00:00:00.000Z`);
	const prevEnd = new Date(`${prevWeek.endDate}T23:59:59.999Z`);

	const dayContexts = Array.from({ length: 7 }, (_, i) => {
		const d = new Date(prevStart);
		d.setUTCDate(prevStart.getUTCDate() + i);
		return `week:${prevWeek.dashedKey}:day:${d.toISOString().slice(0, 10)}`;
	});

	const [
		prevArtifact,
		prevChecklist,
		prevGoals,
		workoutRows,
		weightRows,
		dayChecklists
	] = await Promise.all([
		getPlanArtifact(userId, 'week', prevWeek.compactKey),
		db.query.checklists.findFirst({
			where: and(eq(checklists.userId, userId), eq(checklists.context, prevWeek.contextKey)),
			with: {
				items: {
					orderBy: (items, { asc: a }) => [a(items.sortOrder), a(items.createdAt)]
				}
			}
		}),
		db.query.goals.findMany({
			where: and(
				eq(goals.userId, userId),
				eq(goals.status, 'active'),
				sql`${goals.metadata}->>'weekKey' = ${prevWeek.dashedKey}`
			),
			columns: { id: true, title: true, metadata: true, createdAt: true }
		}),
		db.select({
			sportFamily: workoutDailyAggregates.sportFamily,
			count: workoutDailyAggregates.count,
			distanceMetersSum: workoutDailyAggregates.distanceMetersSum
		})
			.from(workoutDailyAggregates)
			.where(
				and(
					eq(workoutDailyAggregates.userId, userId),
					inArray(workoutDailyAggregates.sportFamily, ['running', 'yoga']),
					gte(workoutDailyAggregates.date, prevStart),
					lte(workoutDailyAggregates.date, prevEnd)
				)
			),
		db.select({ timestamp: sensorEvents.timestamp, data: sensorEvents.data })
			.from(sensorEvents)
			.where(
				and(
					eq(sensorEvents.userId, userId),
					eq(sensorEvents.dataType, 'weight'),
					lte(sensorEvents.timestamp, prevEnd)
				)
			)
			.orderBy(asc(sensorEvents.timestamp)),
		// Day checklists from previous week (to detect items appearing on ≥2 days → recurring)
		db.query.checklists.findMany({
			where: and(
				eq(checklists.userId, userId),
				inArray(checklists.context, dayContexts)
			),
			columns: { id: true, context: true },
			with: {
				items: {
					columns: { text: true, parentId: true }
				}
			}
		})
	]);

	const uncheckedItems = (prevChecklist?.items ?? [])
		.filter((i) => !i.checked && !i.parentId)
		.map((i) => ({ id: i.id, text: i.text }));

	const canonicalText = new Map<string, string>();
	function recordCanonical(text: string) {
		const key = text.trim().toLowerCase();
		if (key && !canonicalText.has(key)) canonicalText.set(key, text.trim());
	}

	// Items explicitly on previous week's checklist (planned)
	const prevWeekKeys = new Set<string>();
	for (const item of prevChecklist?.items ?? []) {
		if (item.parentId) continue;
		const key = item.text.trim().toLowerCase();
		if (key) { prevWeekKeys.add(key); recordCanonical(item.text); }
	}

	// Items appearing in ≥2 distinct days of prev week → recurring daily-ish task
	const dayFrequency = new Map<string, Set<string>>();
	for (const cl of dayChecklists) {
		const dayKey = cl.context ?? cl.id;
		const seenHere = new Set<string>();
		for (const item of cl.items) {
			if (item.parentId) continue;
			const key = item.text.trim().toLowerCase();
			if (!key || seenHere.has(key)) continue;
			seenHere.add(key);
			if (!dayFrequency.has(key)) dayFrequency.set(key, new Set());
			dayFrequency.get(key)!.add(dayKey);
			recordCanonical(item.text);
		}
	}

	const recurringKeys = new Set<string>([
		...prevWeekKeys,
		...[...dayFrequency.entries()].filter(([, days]) => days.size >= 2).map(([k]) => k)
	]);

	const recurringTasks = [...recurringKeys].map((key) => canonicalText.get(key) ?? key);

	// Compute previous week goal progress
	const runningKm = Math.round(
		workoutRows
			.filter((r) => r.sportFamily === 'running')
			.reduce((sum, r) => sum + Number(r.distanceMetersSum ?? 0) / 1000, 0) * 10
	) / 10;
	const yogaSessions = workoutRows
		.filter((r) => r.sportFamily === 'yoga')
		.reduce((sum, r) => sum + Number(r.count ?? 0), 0);
	const normalizedWeights = weightRows
		.map((r) => ({ timestamp: r.timestamp, weight: Number((r.data as { weight?: number } | null)?.weight) }))
		.filter((r) => Number.isFinite(r.weight));
	const latestWeight = normalizedWeights.at(-1)?.weight ?? null;

	const weekGoals = prevGoals.map((g) => {
		const meta = (g.metadata ?? {}) as Record<string, any>;
		const tracking = (meta.tracking ?? {}) as { metric?: string };
		const target = (meta.target as { value: number; unit: string } | undefined) ?? { value: 0, unit: '' };
		const trackingMetric = tracking.metric ?? 'manual_counter';
		let currentValue = Number(meta.currentValue ?? 0);
		if (trackingMetric === 'running_distance') currentValue = runningKm;
		if (trackingMetric === 'yoga_sessions') currentValue = yogaSessions;
		if (trackingMetric === 'weight_kg' && latestWeight !== null) currentValue = Math.round(latestWeight * 10) / 10;
		return { title: g.title, currentValue, target, trackingMetric };
	});

	return json({
		currentWeekKey: currentWeek.dashedKey,
		currentWeekNo: currentWeek.weekNo,
		prevWeekKey: prevWeek.dashedKey,
		prevWeekNo: prevWeek.weekNo,
		note: prevArtifact?.note ?? '',
		reflection: prevArtifact?.reflection ?? '',
		uncheckedItems,
		weekGoals,
		recurringTasks
	});
};
