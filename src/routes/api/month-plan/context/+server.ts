import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklistItems, checklists, goals, sensorEvents, workoutDailyAggregates } from '$lib/db/schema';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { getPlanArtifact } from '$lib/server/plan-artifacts';

function getMonthInfo(now: Date = new Date()) {
	const year = now.getFullYear();
	const month = now.getMonth() + 1;
	const monthStr = String(month).padStart(2, '0');
	const daysInMonth = new Date(year, month, 0).getDate();
	const endDay = String(daysInMonth).padStart(2, '0');
	const monthName = new Intl.DateTimeFormat('nb-NO', { month: 'long' }).format(new Date(year, month - 1, 1));
	return {
		year,
		month: monthStr,
		dashedKey: `${year}-${monthStr}`,
		compactKey: `${year}M${monthStr}`,
		contextKey: `month:${year}-${monthStr}`,
		startDate: `${year}-${monthStr}-01`,
		endDate: `${year}-${monthStr}-${endDay}`,
		monthName
	};
}

function getMonthInfoFromKey(key: string) {
	const match = key.match(/^(\d{4})-(\d{2})$/);
	if (!match) return null;
	const year = parseInt(match[1], 10);
	const month = parseInt(match[2], 10);
	if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
	return getMonthInfo(new Date(year, month - 1, 1));
}

function shiftMonth(info: ReturnType<typeof getMonthInfo>, delta: number) {
	return getMonthInfo(new Date(info.year, parseInt(info.month, 10) - 1 + delta, 1));
}

export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const requestedMonth = url.searchParams.get('month');
	const currentMonth = requestedMonth
		? (getMonthInfoFromKey(requestedMonth) ?? getMonthInfo())
		: getMonthInfo();
	const prevMonth = shiftMonth(currentMonth, -1);

	// Previous month date range
	const prevStart = new Date(`${prevMonth.startDate}T00:00:00.000Z`);
	const prevEnd = new Date(`${prevMonth.endDate}T23:59:59.999Z`);

	const [
		prevArtifact,
		prevChecklist,
		prevGoals,
		workoutRows,
		weightRows,
		weekChecklists
	] = await Promise.all([
		getPlanArtifact(userId, 'month', prevMonth.compactKey),
		db.query.checklists.findFirst({
			where: and(eq(checklists.userId, userId), eq(checklists.context, prevMonth.contextKey)),
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
				sql`${goals.metadata}->>'monthKey' = ${prevMonth.dashedKey}`
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
		// Week and day checklists within the previous month only
		db.query.checklists.findMany({
			where: and(
				eq(checklists.userId, userId),
				sql`${checklists.context} LIKE 'week:%'`,
				gte(checklists.createdAt, prevStart),
				lte(checklists.createdAt, prevEnd)
			),
			columns: { id: true, context: true },
			with: {
				items: {
					columns: { text: true, parentId: true }
				}
			}
		})
	]);

	// Unchecked items from previous month checklist
	const uncheckedItems = (prevChecklist?.items ?? [])
		.filter((i) => !i.checked && !i.parentId)
		.map((i) => ({ id: i.id, text: i.text }));

	const canonicalText = new Map<string, string>();
	function recordCanonical(text: string) {
		const key = text.trim().toLowerCase();
		if (key && !canonicalText.has(key)) canonicalText.set(key, text.trim());
	}

	// ── Month checklist items from previous month (explicitly planned) ────────
	const prevMonthKeys = new Set<string>();
	for (const item of prevChecklist?.items ?? []) {
		if (item.parentId) continue;
		const key = item.text.trim().toLowerCase();
		if (key) { prevMonthKeys.add(key); recordCanonical(item.text); }
	}

	// ── Week/day checklists: items in ≥2 distinct ISO weeks last month ────────
	function weekGroup(context: string | null): string {
		if (!context) return '';
		const m = context.match(/^(week:\d{4}-W\d{2})/);
		return m?.[1] ?? context;
	}

	const weekFrequency = new Map<string, Set<string>>();
	for (const cl of weekChecklists) {
		const group = weekGroup(cl.context);
		if (!group) continue;
		const seenHere = new Set<string>();
		for (const item of cl.items) {
			if (item.parentId) continue;
			const key = item.text.trim().toLowerCase();
			if (!key || seenHere.has(key)) continue;
			seenHere.add(key);
			if (!weekFrequency.has(key)) weekFrequency.set(key, new Set());
			weekFrequency.get(key)!.add(group);
			recordCanonical(item.text);
		}
	}

	// Recurring = appeared in prev month checklist OR in ≥2 distinct weeks last month
	const recurringKeys = new Set<string>([
		...prevMonthKeys,
		...[...weekFrequency.entries()].filter(([, weeks]) => weeks.size >= 2).map(([k]) => k)
	]);

	const recurringTasks = [...recurringKeys].map((key) => canonicalText.get(key) ?? key);

	// Compute previous month goal progress
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

	const monthGoals = prevGoals.map((g) => {
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
		currentMonthKey: currentMonth.dashedKey,
		currentMonthName: currentMonth.monthName,
		prevMonthKey: prevMonth.dashedKey,
		prevMonthName: prevMonth.monthName,
		note: prevArtifact?.note ?? '',
		reflection: prevArtifact?.reflection ?? '',
		uncheckedItems,
		monthGoals,
		recurringTasks
	});
};
