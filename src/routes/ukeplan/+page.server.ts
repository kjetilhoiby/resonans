import { fail } from '@sveltejs/kit';
import { and, eq, gte, inArray, lt, or } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/db';
import { checklistItems, checklists, goals, memories, progress, tasks, themes } from '$lib/db/schema';

async function loadWeekTasks(userId: string, dashedKey: string, compactKey: string) {
	const baseSelect = db
		.select({
			id: tasks.id,
			title: tasks.title,
			frequency: tasks.frequency,
			targetValue: tasks.targetValue,
			goalTitle: goals.title,
			themeName: themes.name
		})
		.from(tasks)
		.leftJoin(goals, eq(tasks.goalId, goals.id))
		.leftJoin(themes, eq(goals.themeId, themes.id));

	try {
		return await baseSelect.where(
			and(
				eq(tasks.status, 'active'),
				eq(goals.userId, userId),
				eq(tasks.periodType, 'week'),
				or(eq(tasks.periodId, dashedKey), eq(tasks.periodId, compactKey))
			)
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		// Backward compatibility for databases where period columns are not migrated yet.
		if (!/period_type|period_id/i.test(message)) {
			throw error;
		}

		return await baseSelect.where(and(eq(tasks.status, 'active'), eq(goals.userId, userId)));
	}
}

function parseRepeatCount(raw: string): { count: number; label: string } {
	const text = raw.trim();
	const match = text.match(/^(\d{1,2})\s+(.+)$/);
	if (!match) return { count: 1, label: text };

	const count = Number.parseInt(match[1], 10);
	if (!Number.isFinite(count) || count < 1 || count > 12) {
		return { count: 1, label: text };
	}

	return { count, label: match[2].trim() };
}

function getIsoWeekInfo(now: Date = new Date()) {
	const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const year = d.getUTCFullYear();
	const yearStart = new Date(Date.UTC(year, 0, 1));
	const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	const week = String(weekNo).padStart(2, '0');

	const monday = new Date(d);
	monday.setUTCDate(d.getUTCDate() - 3);

	const days = Array.from({ length: 7 }, (_, i) => {
		const date = new Date(monday);
		date.setUTCDate(monday.getUTCDate() + i);
		const isoDate = date.toISOString().slice(0, 10);
		return {
			isoDate,
			label: new Intl.DateTimeFormat('nb-NO', { weekday: 'short' }).format(date),
			day: String(date.getUTCDate())
		};
	});

	return {
		year,
		week,
		compactKey: `${year}W${week}`,
		dashedKey: `${year}-W${week}`,
		contextKey: `week:${year}-W${week}`,
		days
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

function shiftWeek(week: ReturnType<typeof getIsoWeekInfo>, delta: number) {
	const monday = new Date(`${week.days[0].isoDate}T00:00:00.000Z`);
	monday.setUTCDate(monday.getUTCDate() + delta * 7);
	return getIsoWeekInfo(monday);
}

function resolveWeekFromFormData(formData: FormData) {
	const weekKey = String(formData.get('weekKey') || '').trim();
	return getIsoWeekInfoFromKey(weekKey) ?? getIsoWeekInfo();
}

async function upsertWeekNote(userId: string, source: string, content: string) {
	const trimmed = content.trim();
	const existing = await db.query.memories.findFirst({
		where: and(eq(memories.userId, userId), eq(memories.source, source))
	});

	if (!trimmed) {
		if (existing) {
			await db.delete(memories).where(eq(memories.id, existing.id));
		}
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

export const load: PageServerLoad = async ({ locals, url }) => {
	const userId = locals.userId;
	const requestedWeek = url.searchParams.get('week');
	const week = requestedWeek ? (getIsoWeekInfoFromKey(requestedWeek) ?? getIsoWeekInfo()) : getIsoWeekInfo();
	const previousWeek = shiftWeek(week, -1);
	const nextWeek = shiftWeek(week, 1);
	const weekStart = new Date(`${week.days[0].isoDate}T00:00:00.000Z`);
	const weekEndExclusive = new Date(weekStart);
	weekEndExclusive.setUTCDate(weekEndExclusive.getUTCDate() + 7);
	const dayContexts = week.days.map((d) => `week:${week.dashedKey}:day:${d.isoDate}`);
	const dayNoteSources = week.days.map((d) => `week-plan:${week.compactKey}:day:${d.isoDate}:note`);
	const dayHeadlineSources = week.days.map((d) => `week-plan:${week.compactKey}:day:${d.isoDate}:headline`);

	const previousWeekStart = new Date(`${previousWeek.days[0].isoDate}T00:00:00.000Z`);
	const previousWeekEndExclusive = new Date(previousWeekStart);
	previousWeekEndExclusive.setUTCDate(previousWeekEndExclusive.getUTCDate() + 7);

	const [weekChecklist, weekTasks, weekProgressRows, reflectionNote, visionNote, weekNote, longTermGoals, dayChecklists, dayNotes, dayHeadlines, previousWeekChecklist, previousWeekNote, previousWeekReflection, previousWeekTasks, previousWeekProgressRows, travelThemes] = await Promise.all([
		db.query.checklists.findFirst({
			where: and(eq(checklists.userId, userId), eq(checklists.context, week.contextKey)),
			with: {
				items: {
					orderBy: (items, { asc: orderAsc }) => [orderAsc(items.sortOrder), orderAsc(items.createdAt)]
				}
			},
			orderBy: (c, { desc: orderDesc }) => [orderDesc(c.createdAt)]
		}),
		loadWeekTasks(userId, week.dashedKey, week.compactKey),
		db.query.progress.findMany({
			where: and(eq(progress.userId, userId), gte(progress.completedAt, weekStart), lt(progress.completedAt, weekEndExclusive)),
			columns: {
				taskId: true
			}
		}),
		db.query.memories.findFirst({
			where: and(eq(memories.userId, userId), eq(memories.source, `week-plan:${week.compactKey}:reflection`))
		}),
		db.query.memories.findFirst({
			where: and(eq(memories.userId, userId), eq(memories.source, `week-plan:${week.compactKey}:vision`))
		}),
		db.query.memories.findFirst({
			where: and(eq(memories.userId, userId), eq(memories.source, `week-plan:${week.compactKey}:note`))
		}),
		db.query.goals.findMany({
			where: and(eq(goals.userId, userId), eq(goals.status, 'active')),
			columns: {
				id: true,
				title: true,
				targetDate: true
			},
			orderBy: (g, { asc: orderAsc }) => [orderAsc(g.targetDate), orderAsc(g.createdAt)],
			limit: 5
		}),
		db.query.checklists.findMany({
			where: and(eq(checklists.userId, userId), inArray(checklists.context, dayContexts)),
			with: {
				items: {
					orderBy: (items, { asc: orderAsc }) => [orderAsc(items.sortOrder), orderAsc(items.createdAt)]
				}
			}
		}),
		db.query.memories.findMany({
			where: and(eq(memories.userId, userId), inArray(memories.source, dayNoteSources)),
			columns: {
				source: true,
				content: true
			}
		}),
		db.query.memories.findMany({
			where: and(eq(memories.userId, userId), inArray(memories.source, dayHeadlineSources)),
			columns: {
				source: true,
				content: true
			}
		}),
		db.query.checklists.findFirst({
			where: and(eq(checklists.userId, userId), eq(checklists.context, previousWeek.contextKey)),
			with: {
				items: {
					orderBy: (items, { asc: orderAsc }) => [orderAsc(items.sortOrder), orderAsc(items.createdAt)]
				}
			},
			orderBy: (c, { desc: orderDesc }) => [orderDesc(c.createdAt)]
		}),
		db.query.memories.findFirst({
			where: and(eq(memories.userId, userId), eq(memories.source, `week-plan:${previousWeek.compactKey}:note`))
		}),
		db.query.memories.findFirst({
			where: and(eq(memories.userId, userId), eq(memories.source, `week-plan:${previousWeek.compactKey}:reflection`))
		}),
		loadWeekTasks(userId, previousWeek.dashedKey, previousWeek.compactKey),
		db.query.progress.findMany({
			where: and(
				eq(progress.userId, userId),
				gte(progress.completedAt, previousWeekStart),
				lt(progress.completedAt, previousWeekEndExclusive)
			),
			columns: {
				taskId: true
			}
		}),
		db.query.themes.findMany({
			where: and(eq(themes.userId, userId), eq(themes.archived, false)),
			columns: { id: true, name: true, emoji: true, tripProfile: true }
		})
	]);

	const progressCounts = weekProgressRows.reduce((acc, row) => {
		if (!row.taskId) return acc;
		acc[row.taskId] = (acc[row.taskId] ?? 0) + 1;
		return acc;
	}, {} as Record<string, number>);

	const dayChecklistMap = Object.fromEntries(dayChecklists.map((cl) => {
		const key = cl.context?.split(':day:')[1] ?? cl.id;
		return [
			key,
			{
				id: cl.id,
				title: cl.title,
				items: cl.items,
				completedAt: cl.completedAt?.toISOString() ?? null
			}
		];
	}));

	const dayNoteMap = Object.fromEntries(dayNotes.map((note) => {
		const dayKey = note.source?.match(/:day:(\d{4}-\d{2}-\d{2}):note$/)?.[1] ?? note.source;
		return [dayKey, note.content];
	}));

	const dayHeadlineMap = Object.fromEntries(dayHeadlines.map((note) => {
		const dayKey = note.source?.match(/:day:(\d{4}-\d{2}-\d{2}):headline$/)?.[1] ?? note.source;
		return [dayKey, note.content];
	}));

	const previousProgressCounts = previousWeekProgressRows.reduce((acc, row) => {
		if (!row.taskId) return acc;
		acc[row.taskId] = (acc[row.taskId] ?? 0) + 1;
		return acc;
	}, {} as Record<string, number>);

	const previousIncompleteTasks = previousWeekTasks
		.filter((task) => {
			const repeatCount =
				task.frequency === 'weekly' && typeof task.targetValue === 'number' && task.targetValue > 1
					? Math.min(task.targetValue, 12)
					: 1;
			return (previousProgressCounts[task.id] ?? 0) < repeatCount;
		})
		.map((task) => task.title);

	const carryoverItems = (previousWeekChecklist?.items ?? [])
		.filter((item) => !item.checked)
		.map((item) => item.text);

	// Find trips that overlap this week
	const weekStartStr = week.days[0].isoDate;
	const weekEndStr = week.days[6].isoDate;
	const activeTrips = travelThemes
		.filter((t) => {
			const p = t.tripProfile;
			if (!p?.startDate || !p?.endDate) return false;
			// Overlaps if trip starts before week ends AND trip ends after week starts
			return p.startDate <= weekEndStr && p.endDate >= weekStartStr;
		})
		.map((t) => ({
			id: t.id,
			name: t.name,
			emoji: t.emoji,
			destination: t.tripProfile?.destination ?? null,
			startDate: t.tripProfile!.startDate!,
			endDate: t.tripProfile!.endDate!
		}));

	return {
		week,
		weekNav: {
			previousWeekKey: previousWeek.dashedKey,
			nextWeekKey: nextWeek.dashedKey,
			isCurrentWeek: week.dashedKey === getIsoWeekInfo().dashedKey
		},
		weekChecklist: weekChecklist
			? {
				id: weekChecklist.id,
				title: weekChecklist.title,
				emoji: weekChecklist.emoji,
				completedAt: weekChecklist.completedAt?.toISOString() ?? null,
				items: weekChecklist.items
			}
			: null,
		weekTasks: weekTasks.map((task) => ({
			id: task.id,
			title: task.title,
			frequency: task.frequency,
			targetValue: task.targetValue,
			repeatCount:
				task.frequency === 'weekly' && typeof task.targetValue === 'number' && task.targetValue > 1
					? Math.min(task.targetValue, 12)
					: 1,
			completedCount: progressCounts[task.id] ?? 0,
			goalTitle: task.goalTitle ?? null,
			themeName: task.themeName ?? null
		})),
		weekNote: weekNote?.content ?? '',
		reflection: reflectionNote?.content ?? '',
		vision: visionNote?.content ?? '',
		longTermGoals: longTermGoals.map((goal) => ({
			id: goal.id,
			title: goal.title,
			targetDate: goal.targetDate?.toISOString() ?? null
		})),
		dayChecklists: dayChecklistMap,
		dayNotes: dayNoteMap,
		dayHeadlines: dayHeadlineMap,
		activeTrips,
		previousWeekSummary: {
			weekKey: previousWeek.dashedKey,
			note: previousWeekNote?.content ?? '',
			reflection: previousWeekReflection?.content ?? '',
			carryoverItems,
			incompleteTasks: previousIncompleteTasks
		}
	};
};

export const actions = {
	createChecklist: async ({ locals }) => {
		const userId = locals.userId;
		const week = getIsoWeekInfo();

		const existing = await db.query.checklists.findFirst({
			where: and(eq(checklists.userId, userId), eq(checklists.context, week.contextKey)),
			orderBy: (c, { desc: orderDesc }) => [orderDesc(c.createdAt)]
		});

		if (!existing) {
			await db.insert(checklists).values({
				userId,
				title: `Uke ${week.week}`,
				emoji: '🗓️',
				context: week.contextKey
			});
		}

		return { success: true };
	},

	createChecklistForWeek: async ({ locals, request }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const week = resolveWeekFromFormData(data);

		const existing = await db.query.checklists.findFirst({
			where: and(eq(checklists.userId, userId), eq(checklists.context, week.contextKey)),
			orderBy: (c, { desc: orderDesc }) => [orderDesc(c.createdAt)]
		});

		if (!existing) {
			await db.insert(checklists).values({
				userId,
				title: `Uke ${week.week}`,
				emoji: '🗓️',
				context: week.contextKey
			});
		}

		return { success: true };
	},

	addItem: async ({ request, locals }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const checklistId = String(data.get('checklistId') || '');
		const text = String(data.get('text') || '').trim();
		const repeatRaw = String(data.get('count') || '1');
		const requestedRepeats = Math.min(Math.max(Number.parseInt(repeatRaw, 10) || 1, 1), 12);

		if (!checklistId || !text) {
			return fail(400, { error: 'Mangler checklistId eller tekst.' });
		}

		const checklist = await db.query.checklists.findFirst({
			where: and(eq(checklists.id, checklistId), eq(checklists.userId, userId))
		});

		if (!checklist) {
			return fail(404, { error: 'Fant ikke sjekklisten.' });
		}

		const existingItems = await db.query.checklistItems.findMany({
			where: eq(checklistItems.checklistId, checklistId),
			columns: { id: true }
		});
		const parsed = parseRepeatCount(text);
		const repeatCount = Math.min(Math.max(parsed.count, requestedRepeats), 12);

		await db.insert(checklistItems).values(
			Array.from({ length: repeatCount }, (_, index) => ({
				checklistId,
				userId,
				text: repeatCount > 1 ? `${parsed.label} (${index + 1}/${repeatCount})` : text,
				sortOrder: existingItems.length + index
			}))
		);

		if (checklist.completedAt) {
			await db
				.update(checklists)
				.set({ completedAt: null })
				.where(eq(checklists.id, checklistId));
		}

		return { success: true };
	},

	createDayChecklist: async ({ request, locals }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const week = resolveWeekFromFormData(data);
		const dayIso = String(data.get('dayIso') || '').trim();

		if (!dayIso) {
			return fail(400, { error: 'Mangler dag.' });
		}

		const context = `week:${week.dashedKey}:day:${dayIso}`;
		const existing = await db.query.checklists.findFirst({
			where: and(eq(checklists.userId, userId), eq(checklists.context, context))
		});

		if (!existing) {
			await db.insert(checklists).values({
				userId,
				title: `Dag ${dayIso}`,
				emoji: '☑️',
				context
			});
		}

		return { success: true };
	},

	toggleItem: async ({ request, locals }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const checklistId = String(data.get('checklistId') || '');
		const itemId = String(data.get('itemId') || '');
		const nextChecked = String(data.get('nextChecked') || 'false') === 'true';

		if (!checklistId || !itemId) {
			return fail(400, { error: 'Mangler itemId eller checklistId.' });
		}

		const item = await db.query.checklistItems.findFirst({
			where: and(eq(checklistItems.id, itemId), eq(checklistItems.userId, userId))
		});

		if (!item) {
			return fail(404, { error: 'Fant ikke punktet.' });
		}

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

	saveWeekNote: async ({ request, locals }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const week = resolveWeekFromFormData(data);
		const weekNote = String(data.get('weekNote') || '');

		await upsertWeekNote(userId, `week-plan:${week.compactKey}:note`, weekNote);
		return { success: true };
	},

	saveDayNote: async ({ request, locals }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const week = resolveWeekFromFormData(data);
		const dayIso = String(data.get('dayIso') || '').trim();
		const note = String(data.get('dayNote') || '');

		if (!dayIso) {
			return fail(400, { error: 'Mangler dag.' });
		}

		await upsertWeekNote(userId, `week-plan:${week.compactKey}:day:${dayIso}:note`, note);
		return { success: true };
	},

	saveDayHeadline: async ({ request, locals }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const week = resolveWeekFromFormData(data);
		const dayIso = String(data.get('dayIso') || '').trim();
		const headline = String(data.get('headline') || '');

		if (!dayIso) {
			return fail(400, { error: 'Mangler dag.' });
		}

		await upsertWeekNote(userId, `week-plan:${week.compactKey}:day:${dayIso}:headline`, headline);
		return { success: true };
	},

	saveNotes: async ({ request, locals }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const week = resolveWeekFromFormData(data);
		const reflection = String(data.get('reflection') || '');
		const vision = String(data.get('vision') || '');

		await Promise.all([
			upsertWeekNote(userId, `week-plan:${week.compactKey}:reflection`, reflection),
			upsertWeekNote(userId, `week-plan:${week.compactKey}:vision`, vision)
		]);

		return { success: true };
	}
} satisfies Actions;
