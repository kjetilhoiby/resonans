import { fail } from '@sveltejs/kit';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/db';
import { checklistItems, checklists, goals, memories, sensorEvents, themes, workoutDailyAggregates } from '$lib/db/schema';
import { parseListRepeatCount } from '$lib/server/list-repeat-parser';

// ── Month helpers ────────────────────────────────────────────────────────────

type MonthInfo = {
	year: number;
	month: string; // "04"
	dashedKey: string; // "2026-04"
	compactKey: string; // "2026M04"
	contextKey: string; // "month:2026-04"
	startDate: string; // "2026-04-01"
	endDate: string; // "2026-04-30"
	monthName: string; // "april"
};

export type WeekInMonth = {
	year: number;
	week: string; // "17"
	dashedKey: string; // "2026-W17"
	contextKey: string; // "week:2026-W17"
	startDate: string; // "2026-04-20"
	endDate: string; // "2026-04-26"
	daysInMonth: number; // how many days of this week fall within the month
};

function getMonthInfo(now: Date = new Date()): MonthInfo {
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

function getMonthInfoFromKey(key: string): MonthInfo | null {
	const match = key.match(/^(\d{4})-(\d{2})$/);
	if (!match) return null;
	const year = parseInt(match[1], 10);
	const month = parseInt(match[2], 10);
	if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
	return getMonthInfo(new Date(year, month - 1, 1));
}

function shiftMonth(month: MonthInfo, delta: number): MonthInfo {
	return getMonthInfo(new Date(month.year, parseInt(month.month, 10) - 1 + delta, 1));
}

// ISO week helpers (same algorithm as ukeplan)
function getIsoWeekFromDate(now: Date) {
	const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
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
		dashedKey: `${year}-W${week}`,
		contextKey: `week:${year}-W${week}`,
		startDate: monday.toISOString().slice(0, 10),
		endDate: sunday.toISOString().slice(0, 10)
	};
}

function getWeeksInMonth(month: MonthInfo): WeekInMonth[] {
	const seen = new Map<string, WeekInMonth>();
	const end = new Date(`${month.endDate}T12:00:00.000Z`);
	let current = new Date(`${month.startDate}T12:00:00.000Z`);

	while (current <= end) {
		const w = getIsoWeekFromDate(current);
		if (!seen.has(w.dashedKey)) {
			let daysInMonth = 0;
			const wStart = new Date(`${w.startDate}T12:00:00.000Z`);
			for (let i = 0; i < 7; i++) {
				const d = new Date(wStart);
				d.setUTCDate(wStart.getUTCDate() + i);
				const iso = d.toISOString().slice(0, 10);
				if (iso >= month.startDate && iso <= month.endDate) daysInMonth++;
			}
			seen.set(w.dashedKey, { ...w, daysInMonth });
		}
		current.setUTCDate(current.getUTCDate() + 1);
	}

	return Array.from(seen.values()).sort((a, b) => a.dashedKey.localeCompare(b.dashedKey));
}

async function upsertMonthNote(userId: string, source: string, content: string) {
	const trimmed = content.trim();
	const existing = await db.query.memories.findFirst({
		columns: { id: true },
		where: and(eq(memories.userId, userId), eq(memories.source, source))
	});

	if (!trimmed) {
		if (existing) await db.delete(memories).where(eq(memories.id, existing.id));
		return;
	}

	if (existing) {
		await db
			.update(memories)
			.set({ content: trimmed, updatedAt: new Date(), lastAccessedAt: new Date() })
			.where(eq(memories.id, existing.id));
		return;
	}

	await db.insert(memories).values({
		userId,
		category: 'other',
		content: trimmed,
		importance: 'medium',
		source
	});
}

// ── Load ─────────────────────────────────────────────────────────────────────

export const load: PageServerLoad = async ({ locals, url }) => {
	const userId = locals.userId;
	const requestedMonth = url.searchParams.get('month');
	const month = requestedMonth ? (getMonthInfoFromKey(requestedMonth) ?? getMonthInfo()) : getMonthInfo();
	const previousMonth = shiftMonth(month, -1);
	const nextMonth = shiftMonth(month, 1);
	const weeksInMonth = getWeeksInMonth(month);
	const weekContextKeys = weeksInMonth.map((w) => w.contextKey);
	const monthStart = new Date(`${month.startDate}T00:00:00.000Z`);
	const monthEnd = new Date(`${month.endDate}T23:59:59.999Z`);

	const [
		monthChecklist,
		monthNote,
		reflectionNote,
		visionNote,
		longTermGoals,
		monthGoals,
		workoutRows,
		weightRows,
		weekChecklists,
		prevMonthNote,
		prevMonthReflection
	] = await Promise.all([
		db.query.checklists.findFirst({
			where: and(eq(checklists.userId, userId), eq(checklists.context, month.contextKey)),
			with: {
				items: {
					orderBy: (items, { asc: a }) => [a(items.sortOrder), a(items.createdAt)]
				}
			},
			orderBy: (c, { desc: d }) => [d(c.createdAt)]
		}),
		db.query.memories.findFirst({
			columns: { content: true },
			where: and(eq(memories.userId, userId), eq(memories.source, `month-plan:${month.compactKey}:note`))
		}),
		db.query.memories.findFirst({
			columns: { content: true },
			where: and(eq(memories.userId, userId), eq(memories.source, `month-plan:${month.compactKey}:reflection`))
		}),
		db.query.memories.findFirst({
			columns: { content: true },
			where: and(eq(memories.userId, userId), eq(memories.source, `month-plan:${month.compactKey}:vision`))
		}),
		db.query.goals.findMany({
			where: and(
				eq(goals.userId, userId),
				eq(goals.status, 'active'),
				sql`(${goals.metadata}->>'monthKey') IS NULL`
			),
			columns: { id: true, title: true, targetDate: true, createdAt: true },
			orderBy: (g, { asc: a }) => [a(g.targetDate), a(g.createdAt)],
			limit: 6
		}),
		db.query.goals.findMany({
			where: and(
				eq(goals.userId, userId),
				eq(goals.status, 'active'),
				sql`${goals.metadata}->>'monthKey' = ${month.dashedKey}`
			),
			columns: { id: true, title: true, metadata: true, createdAt: true },
			orderBy: (g, { asc: a }) => [a(g.createdAt)]
		}),
		db
			.select({
				sportFamily: workoutDailyAggregates.sportFamily,
				count: workoutDailyAggregates.count,
				distanceMetersSum: workoutDailyAggregates.distanceMetersSum
			})
			.from(workoutDailyAggregates)
			.where(
				and(
					eq(workoutDailyAggregates.userId, userId),
					inArray(workoutDailyAggregates.sportFamily, ['running', 'yoga']),
					gte(workoutDailyAggregates.date, monthStart),
					lte(workoutDailyAggregates.date, monthEnd)
				)
			),
		db
			.select({
				timestamp: sensorEvents.timestamp,
				data: sensorEvents.data
			})
			.from(sensorEvents)
			.where(
				and(
					eq(sensorEvents.userId, userId),
					eq(sensorEvents.dataType, 'weight'),
					lte(sensorEvents.timestamp, monthEnd)
				)
			)
			.orderBy(asc(sensorEvents.timestamp)),
		weekContextKeys.length > 0
			? db.query.checklists.findMany({
					where: and(eq(checklists.userId, userId), inArray(checklists.context, weekContextKeys)),
					with: {
						items: {
							orderBy: (items, { asc: a }) => [a(items.sortOrder), a(items.createdAt)]
						}
					}
			  })
			: Promise.resolve([]),
		db.query.memories.findFirst({
			columns: { content: true },
			where: and(
				eq(memories.userId, userId),
				eq(memories.source, `month-plan:${previousMonth.compactKey}:note`)
			)
		}),
		db.query.memories.findFirst({
			columns: { content: true },
			where: and(
				eq(memories.userId, userId),
				eq(memories.source, `month-plan:${previousMonth.compactKey}:reflection`)
			)
		})
	]);

	const weekChecklistMap = Object.fromEntries(
		weekChecklists.map((cl) => {
			const weekKey = cl.context?.replace('week:', '') ?? cl.id;
			return [
				weekKey,
				{
					id: cl.id,
					title: cl.title,
					completedAt: cl.completedAt?.toISOString() ?? null,
					items: cl.items.map((i) => ({
						id: i.id,
						text: i.text,
						checked: i.checked
					}))
				}
			];
		})
	);

	const runningKmThisMonth = Math.round(
		workoutRows
			.filter((r) => r.sportFamily === 'running')
			.reduce((sum, r) => sum + Number(r.distanceMetersSum ?? 0) / 1000, 0) * 10
	) / 10;
	const yogaSessionsThisMonth = workoutRows
		.filter((r) => r.sportFamily === 'yoga')
		.reduce((sum, r) => sum + Number(r.count ?? 0), 0);

	const normalizedWeightRows = weightRows
		.map((row) => ({
			timestamp: row.timestamp,
			weight: Number((row.data as { weight?: number } | null)?.weight)
		}))
		.filter((row) => Number.isFinite(row.weight));

	return {
		month,
		monthNav: {
			previousMonthKey: previousMonth.dashedKey,
			nextMonthKey: nextMonth.dashedKey,
			isCurrentMonth: month.dashedKey === getMonthInfo().dashedKey
		},
		monthChecklist: monthChecklist
			? {
					id: monthChecklist.id,
					title: monthChecklist.title,
					emoji: monthChecklist.emoji,
					completedAt: monthChecklist.completedAt?.toISOString() ?? null,
					items: monthChecklist.items.map((i) => ({
						id: i.id,
						text: i.text,
						checked: i.checked
					}))
			  }
			: null,
		monthNote: monthNote?.content ?? '',
		reflection: reflectionNote?.content ?? '',
		vision: visionNote?.content ?? '',
		weeksInMonth,
		weekChecklists: weekChecklistMap,
		longTermGoals: longTermGoals.map((g) => ({
			id: g.id,
			title: g.title,
			targetDate: g.targetDate?.toISOString() ?? null
		})),
		monthGoals: monthGoals.map((g) => {
			const meta = (g.metadata ?? {}) as Record<string, any>;
			const tracking = (meta.tracking ?? {}) as { source?: string; metric?: string };
			const target = (meta.target as { value: number; unit: string } | undefined) ?? {
				value: 0,
				unit: ''
			};

			let currentValue = Number(meta.currentValue ?? 0);
			let baselineValue: number | null =
				typeof meta.baselineValue === 'number' ? Number(meta.baselineValue) : null;

			if (tracking.metric === 'running_distance') {
				currentValue = runningKmThisMonth;
			}

			if (tracking.metric === 'yoga_sessions') {
				currentValue = yogaSessionsThisMonth;
			}

			if (tracking.metric === 'weight_kg') {
				const latest = normalizedWeightRows[normalizedWeightRows.length - 1] ?? null;
				if (latest) currentValue = Math.round(latest.weight * 10) / 10;

				if (baselineValue === null) {
					const beforeGoal = normalizedWeightRows
						.filter((row) => row.timestamp <= g.createdAt)
						.at(-1);
					if (beforeGoal) baselineValue = Math.round(beforeGoal.weight * 10) / 10;
				}
			}

			return {
				id: g.id,
				title: g.title,
				goalType: (meta.goalType as string) ?? 'manual_counter',
				trackingMetric: tracking.metric ?? 'manual_counter',
				target,
				currentValue,
				baselineValue
			};
		}),
		previousMonthSummary: {
			monthKey: previousMonth.dashedKey,
			monthName: previousMonth.monthName,
			note: prevMonthNote?.content ?? '',
			reflection: prevMonthReflection?.content ?? ''
		}
	};
};

// ── Actions ───────────────────────────────────────────────────────────────────

function resolveMonthFromFormData(formData: FormData) {
	const key = String(formData.get('monthKey') || '').trim();
	return getMonthInfoFromKey(key) ?? getMonthInfo();
}

export const actions = {
	createChecklist: async ({ locals, request }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const month = resolveMonthFromFormData(data);

		const existing = await db.query.checklists.findFirst({
			where: and(eq(checklists.userId, userId), eq(checklists.context, month.contextKey))
		});

		if (!existing) {
			await db.insert(checklists).values({
				userId,
				title: `${month.monthName.charAt(0).toUpperCase() + month.monthName.slice(1)} ${month.year}`,
				emoji: '📅',
				context: month.contextKey
			});
		}

		return { success: true };
	},

	addItem: async ({ request, locals }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const checklistId = String(data.get('checklistId') || '');
		const text = String(data.get('text') || '').trim();

		if (!checklistId || !text) return fail(400, { error: 'Mangler checklistId eller tekst.' });

		const checklist = await db.query.checklists.findFirst({
			where: and(eq(checklists.id, checklistId), eq(checklists.userId, userId))
		});
		if (!checklist) return fail(404, { error: 'Fant ikke listen.' });

		const existingItems = await db.query.checklistItems.findMany({
			where: eq(checklistItems.checklistId, checklistId),
			columns: { id: true }
		});

		const parsed = parseListRepeatCount(text, 1, 12);
		await db.insert(checklistItems).values(
			Array.from({ length: parsed.repeatCount }, (_, i) => ({
				checklistId,
				userId,
				text: parsed.repeatCount > 1 ? `${parsed.label} (${i + 1}/${parsed.repeatCount})` : parsed.label,
				sortOrder: existingItems.length + i
			}))
		);

		if (checklist.completedAt) {
			await db.update(checklists).set({ completedAt: null }).where(eq(checklists.id, checklistId));
		}

		return { success: true };
	},

	toggleItem: async ({ request, locals }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const checklistId = String(data.get('checklistId') || '');
		const itemId = String(data.get('itemId') || '');
		const nextChecked = String(data.get('nextChecked') || 'false') === 'true';

		if (!checklistId || !itemId) return fail(400, { error: 'Mangler itemId eller checklistId.' });

		const item = await db.query.checklistItems.findFirst({
			where: and(eq(checklistItems.id, itemId), eq(checklistItems.userId, userId))
		});
		if (!item) return fail(404, { error: 'Fant ikke punktet.' });

		await db
			.update(checklistItems)
			.set({ checked: nextChecked, checkedAt: nextChecked ? new Date() : null })
			.where(eq(checklistItems.id, itemId));

		if (!nextChecked) {
			await db.update(checklists).set({ completedAt: null }).where(eq(checklists.id, checklistId));
			return { success: true };
		}

		const remaining = await db.query.checklistItems.findMany({
			where: and(eq(checklistItems.checklistId, checklistId), eq(checklistItems.checked, false)),
			columns: { id: true }
		});

		if (remaining.length === 0) {
			await db.update(checklists).set({ completedAt: new Date() }).where(eq(checklists.id, checklistId));
		}

		return { success: true };
	},

	saveMonthNote: async ({ request, locals }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const month = resolveMonthFromFormData(data);
		const note = String(data.get('monthNote') || '');
		await upsertMonthNote(userId, `month-plan:${month.compactKey}:note`, note);
		return { success: true };
	},

	saveNotes: async ({ request, locals }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const month = resolveMonthFromFormData(data);
		const reflection = String(data.get('reflection') || '');
		const vision = String(data.get('vision') || '');

		await Promise.all([
			upsertMonthNote(userId, `month-plan:${month.compactKey}:reflection`, reflection),
			upsertMonthNote(userId, `month-plan:${month.compactKey}:vision`, vision)
		]);

		return { success: true };
	},

	deleteItem: async ({ request, locals }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const itemId = String(data.get('itemId') || '');
		if (!itemId) return fail(400, { error: 'Mangler itemId.' });

		const item = await db.query.checklistItems.findFirst({
			where: and(eq(checklistItems.id, itemId), eq(checklistItems.userId, userId))
		});
		if (!item) return fail(404, { error: 'Fant ikke punktet.' });

		await db.delete(checklistItems).where(eq(checklistItems.id, itemId));
		return { success: true };
	},

	addMonthGoal: async ({ request, locals }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const month = resolveMonthFromFormData(data);
		const title = String(data.get('title') || '').trim();
		const goalType = String(data.get('goalType') || 'manual_counter');
		const trackingMetric = String(data.get('trackingMetric') || goalType);
		const targetValue = parseInt(String(data.get('targetValue') || '0'), 10) || 0;
		const unit = String(data.get('unit') || '').trim();

		if (!title) return fail(400, { error: 'Mangler tittel.' });

		let baselineValue: number | null = null;
		if (trackingMetric === 'weight_kg') {
			const latestWeight = await db
				.select({ data: sensorEvents.data })
				.from(sensorEvents)
				.where(
					and(
						eq(sensorEvents.userId, userId),
						eq(sensorEvents.dataType, 'weight'),
						lte(sensorEvents.timestamp, new Date(`${month.endDate}T23:59:59.999Z`))
					)
				)
				.orderBy(desc(sensorEvents.timestamp))
				.limit(1);

			const weight = Number((latestWeight[0]?.data as { weight?: number } | null)?.weight);
			if (Number.isFinite(weight)) baselineValue = Math.round(weight * 10) / 10;
		}

		await db.insert(goals).values({
			userId,
			title,
			status: 'active',
			targetDate: new Date(month.endDate),
			metadata: {
				monthKey: month.dashedKey,
				goalType,
				tracking: {
					source:
						trackingMetric === 'weight_kg'
							? 'sensor_event'
							: trackingMetric === 'running_distance' || trackingMetric === 'yoga_sessions'
								? 'workout_aggregate'
								: 'manual',
					metric: trackingMetric
				},
				target: { value: targetValue, unit },
				baselineValue,
				currentValue: 0
			}
		});

		return { success: true };
	},

	updateMonthGoalProgress: async ({ request, locals }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const goalId = String(data.get('goalId') || '');
		const delta = parseInt(String(data.get('delta') || '0'), 10);

		if (!goalId) return fail(400, { error: 'Mangler goalId.' });

		const goal = await db.query.goals.findFirst({
			where: and(eq(goals.id, goalId), eq(goals.userId, userId))
		});
		if (!goal) return fail(404, { error: 'Fant ikke målet.' });

		const meta = (goal.metadata ?? {}) as Record<string, any>;
		const trackingMetric = String((meta.tracking as { metric?: string } | undefined)?.metric ?? 'manual_counter');
		if (trackingMetric !== 'manual_counter') {
			return fail(400, { error: 'Automatiske mål kan ikke oppdateres manuelt.' });
		}
		const newValue = Math.max(0, (meta.currentValue ?? 0) + delta);

		await db
			.update(goals)
			.set({
				metadata: { ...meta, currentValue: newValue },
				updatedAt: new Date()
			})
			.where(eq(goals.id, goalId));

		return { success: true };
	},

	deleteMonthGoal: async ({ request, locals }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const goalId = String(data.get('goalId') || '');

		if (!goalId) return fail(400, { error: 'Mangler goalId.' });

		const goal = await db.query.goals.findFirst({
			where: and(eq(goals.id, goalId), eq(goals.userId, userId))
		});
		if (!goal) return fail(404, { error: 'Fant ikke målet.' });

		await db.delete(goals).where(eq(goals.id, goalId));
		return { success: true };
	}
} satisfies Actions;
