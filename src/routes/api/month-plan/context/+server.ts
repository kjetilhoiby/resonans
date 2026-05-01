import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklistItems, checklists, goals, memories, sensorEvents, workoutDailyAggregates } from '$lib/db/schema';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

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

	// Months 2 and 3 back for recurring task detection
	const prev2Month = shiftMonth(currentMonth, -2);
	const prev3Month = shiftMonth(currentMonth, -3);
	const recurringContextKeys = [
		prevMonth.contextKey,
		prev2Month.contextKey,
		prev3Month.contextKey
	];

	const [
		prevNote,
		prevReflection,
		prevChecklist,
		prevGoals,
		workoutRows,
		weightRows,
		recurringChecklists
	] = await Promise.all([
		db.query.memories.findFirst({
			columns: { content: true },
			where: and(eq(memories.userId, userId), eq(memories.source, `month-plan:${prevMonth.compactKey}:note`))
		}),
		db.query.memories.findFirst({
			columns: { content: true },
			where: and(eq(memories.userId, userId), eq(memories.source, `month-plan:${prevMonth.compactKey}:reflection`))
		}),
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
		db.query.checklists.findMany({
			where: and(eq(checklists.userId, userId), inArray(checklists.context, recurringContextKeys)),
			with: {
				items: {
					orderBy: (items, { asc: a }) => [a(items.sortOrder), a(items.createdAt)]
				}
			}
		})
	]);

	// Unchecked items from previous month checklist
	const uncheckedItems = (prevChecklist?.items ?? [])
		.filter((i) => !i.checked && !i.parentId)
		.map((i) => ({ id: i.id, text: i.text }));

	// Recurring tasks: items appearing in ≥2 of the 3 previous months
	const textFrequency = new Map<string, number>();
	for (const cl of recurringChecklists) {
		const seenInThisMonth = new Set<string>();
		for (const item of cl.items) {
			if (item.parentId) continue;
			const key = item.text.trim().toLowerCase();
			if (key && !seenInThisMonth.has(key)) {
				seenInThisMonth.add(key);
				textFrequency.set(key, (textFrequency.get(key) ?? 0) + 1);
			}
		}
	}
	// Get original casing from the most recent checklist that has it
	const canonicalText = new Map<string, string>();
	for (const cl of [...recurringChecklists].reverse()) {
		for (const item of cl.items) {
			if (!item.parentId) {
				const key = item.text.trim().toLowerCase();
				if (!canonicalText.has(key)) canonicalText.set(key, item.text.trim());
			}
		}
	}
	const recurringTasks = [...textFrequency.entries()]
		.filter(([, count]) => count >= 2)
		.map(([key]) => canonicalText.get(key) ?? key);

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
		note: prevNote?.content ?? '',
		reflection: prevReflection?.content ?? '',
		uncheckedItems,
		monthGoals,
		recurringTasks
	});
};
