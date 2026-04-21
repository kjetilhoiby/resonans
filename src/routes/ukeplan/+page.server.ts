import { fail } from '@sveltejs/kit';
import { and, eq, gte, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/db';
import { checklistItems, checklists, goals, memories, progress, tasks, themes, sensorEvents, sensors, workoutDailyAggregates } from '$lib/db/schema';
import { parseListRepeatCount } from '$lib/server/list-repeat-parser';
import { refreshWorkoutProjectionsForRange } from '$lib/server/workout-projections';

async function loadWeekTasks(userId: string, dashedKey: string, compactKey: string) {
	const baseSelect = db
		.select({
			id: tasks.id,
			title: tasks.title,
			frequency: tasks.frequency,
			targetValue: tasks.targetValue,
			unit: tasks.unit,
			metadata: tasks.metadata,
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
				or(
					// Period-specific weekly tasks (e.g. single-week task)
					and(
						eq(tasks.periodType, 'week'),
						or(eq(tasks.periodId, dashedKey), eq(tasks.periodId, compactKey))
					),
					// Ongoing recurring weekly tasks (no specific period)
					and(isNull(tasks.periodType), eq(tasks.frequency, 'weekly'))
				)
			)
		);
	} catch (error) {
		// Check the *actual* database error (in error.cause), not error.message which
		// embeds the full SQL and would always match any column name we reference.
		const cause = (error as any)?.cause;
		const causeMessage = cause instanceof Error ? cause.message : String(cause ?? '');

		// Backward compatibility for databases where period columns are not migrated yet.
		if (!/period_type|period_id/i.test(causeMessage)) {
			throw error;
		}

		return await baseSelect.where(and(eq(tasks.status, 'active'), eq(goals.userId, userId)));
	}
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
		columns: { id: true },
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

	const spondSensor = await db.query.sensors.findFirst({
		where: and(eq(sensors.userId, userId), eq(sensors.provider, 'spond'), eq(sensors.isActive, true))
	});

	const [weekChecklist, weekTasks, weekProgressRows, reflectionNote, visionNote, weekNote, longTermGoals, dayChecklists, dayNotes, dayHeadlines, previousWeekChecklist, previousWeekNote, previousWeekReflection, previousWeekTasks, previousWeekProgressRows, travelThemes, rawSpondEvents] = await Promise.all([
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
			columns: { id: true, source: true, content: true },
			where: and(eq(memories.userId, userId), eq(memories.source, `week-plan:${week.compactKey}:reflection`))
		}),
		db.query.memories.findFirst({
			columns: { id: true, source: true, content: true },
			where: and(eq(memories.userId, userId), eq(memories.source, `week-plan:${week.compactKey}:vision`))
		}),
		db.query.memories.findFirst({
			columns: { id: true, source: true, content: true },
			where: and(eq(memories.userId, userId), eq(memories.source, `week-plan:${week.compactKey}:note`))
		}),
		db.query.goals.findMany({
			where: and(eq(goals.userId, userId), eq(goals.status, 'active')),
			columns: {
				id: true,
				title: true,
				targetDate: true,
				metadata: true,
				createdAt: true
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
			columns: { id: true, source: true, content: true },
			where: and(eq(memories.userId, userId), eq(memories.source, `week-plan:${previousWeek.compactKey}:note`))
		}),
		db.query.memories.findFirst({
			columns: { id: true, source: true, content: true },
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
		}),
		spondSensor
			? db.query.sensorEvents.findMany({
					where: and(
						eq(sensorEvents.sensorId, spondSensor.id),
						eq(sensorEvents.dataType, 'spond_event'),
						gte(sensorEvents.timestamp, weekStart),
						lt(sensorEvents.timestamp, weekEndExclusive)
					),
					columns: { id: true, timestamp: true, data: true, metadata: true }
			  })
			: Promise.resolve([] as Array<{ id: string; timestamp: Date; data: unknown; metadata: unknown }>)
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

	// Group Spond events by ISO date, including RSVP status for the account holder's family
	const myMemberIds: string[] = (spondSensor?.config as any)?.myMemberIds ?? [];
	const myMemberSet = new Set(myMemberIds);

	const spondEventsByDay: Record<string, Array<{
		id: string;
		name: string;
		startTimestamp: string;
		endTimestamp: string;
		cancelled: boolean;
		groupName: string | null;
		location: { name: string | null; address: string | null } | null;
		rsvp: 'accepted' | 'declined' | 'unanswered' | 'unknown';
	}>> = {};

	for (const e of rawSpondEvents) {
		const d = e.data as any;
		const dayKey = (e.timestamp as Date).toISOString().slice(0, 10);
		if (!spondEventsByDay[dayKey]) spondEventsByDay[dayKey] = [];

		// Determine RSVP for the account holder's family members
		let rsvp: 'accepted' | 'declined' | 'unanswered' | 'unknown' = 'unknown';
		if (myMemberSet.size > 0) {
			const acceptedIds: string[] = d?.responses?.acceptedIds ?? [];
			const declinedIds: string[] = d?.responses?.declinedIds ?? [];
			const unansweredIds: string[] = d?.responses?.unansweredIds ?? [];
			const isAccepted = acceptedIds.some((id: string) => myMemberSet.has(id));
			const isDeclined = declinedIds.some((id: string) => myMemberSet.has(id));
			const isUnanswered = unansweredIds.some((id: string) => myMemberSet.has(id));
			if (isAccepted) rsvp = 'accepted';
			else if (isDeclined) rsvp = 'declined';
			else if (isUnanswered) rsvp = 'unanswered';
		}

		spondEventsByDay[dayKey].push({
			id: e.id,
			name: d?.name ?? 'Ukjent',
			startTimestamp: d?.startTimestamp ?? e.timestamp.toISOString(),
			endTimestamp: d?.endTimestamp ?? e.timestamp.toISOString(),
			cancelled: d?.cancelled ?? false,
			groupName: d?.groupName ?? null,
			location: d?.location ?? null,
			rsvp,
			spondEventId: (e.metadata as any)?.spondEventId ?? null
		});
	}

	// Calculate sensor progress for running goals
	const sensorProgressMap: Record<string, { currentKm: number; expectedKm: number; targetKm: number; status: 'green' | 'yellow' | 'red' }> = {};
	const runningGoals = longTermGoals
		.map((goal) => {
			const meta = goal.metadata as any;
			if (meta?.metricId !== 'running_distance' || !meta?.startDate) return null;
			const startDate = new Date(meta.startDate);
			const endDate = meta?.endDate ? new Date(meta.endDate) : (goal.targetDate ? new Date(goal.targetDate) : new Date());
			const targetKm: number = meta?.goalTrack?.targetValue ?? 0;
			return { goal, startDate, endDate, targetKm };
		})
		.filter((g): g is { goal: typeof longTermGoals[number]; startDate: Date; endDate: Date; targetKm: number } => g !== null);

	if (runningGoals.length > 0) {
		const tRun = performance.now();
		const minStart = new Date(Math.min(...runningGoals.map((g) => g.startDate.getTime())));
		const maxEnd = new Date(Math.max(...runningGoals.map((g) => g.endDate.getTime())));
		const minStartDay = new Date(Date.UTC(minStart.getUTCFullYear(), minStart.getUTCMonth(), minStart.getUTCDate()));
		const maxEndDay = new Date(Date.UTC(maxEnd.getUTCFullYear(), maxEnd.getUTCMonth(), maxEnd.getUTCDate()));

		let aggregateRows = await db
			.select({ date: workoutDailyAggregates.date, distanceMetersSum: workoutDailyAggregates.distanceMetersSum })
			.from(workoutDailyAggregates)
			.where(
				and(
					eq(workoutDailyAggregates.userId, userId),
					eq(workoutDailyAggregates.sportFamily, 'running'),
					gte(workoutDailyAggregates.date, minStartDay),
					lte(workoutDailyAggregates.date, maxEndDay)
				)
			)
			.orderBy(workoutDailyAggregates.date);

		if (aggregateRows.length === 0) {
			await refreshWorkoutProjectionsForRange(userId, minStartDay, maxEndDay);
			aggregateRows = await db
				.select({ date: workoutDailyAggregates.date, distanceMetersSum: workoutDailyAggregates.distanceMetersSum })
				.from(workoutDailyAggregates)
				.where(
					and(
						eq(workoutDailyAggregates.userId, userId),
						eq(workoutDailyAggregates.sportFamily, 'running'),
						gte(workoutDailyAggregates.date, minStartDay),
						lte(workoutDailyAggregates.date, maxEndDay)
					)
				)
				.orderBy(workoutDailyAggregates.date);
		}

		const dailyRows = aggregateRows.map((row) => ({
			date: row.date,
			km: Number(row.distanceMetersSum ?? 0) / 1000
		}));

		for (const { goal, startDate, endDate, targetKm } of runningGoals) {
			let currentKm = 0;
			for (const row of dailyRows) {
				if (row.date < startDate || row.date > endDate) continue;
				currentKm += row.km;
			}
			currentKm = Math.round(currentKm * 10) / 10;

			const now = new Date();
			const totalDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
			const elapsedDays = Math.min(totalDays, (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
			const expectedKm = (elapsedDays / totalDays) * targetKm;

			const ratio = expectedKm > 0 ? currentKm / expectedKm : 1;
			let status: 'green' | 'yellow' | 'red' = 'green';
			if (ratio < 0.80) status = 'red';
			else if (ratio < 0.95) status = 'yellow';

			sensorProgressMap[goal.id] = { currentKm, expectedKm: Math.round(expectedKm * 10) / 10, targetKm, status };
		}

		console.log(`[ukeplan/load] running progress via aggregates: ${(performance.now() - tRun).toFixed(0)}ms (${runningGoals.length} goals, ${aggregateRows.length} daily rows)`);
	}

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
			unit: task.unit,
			metadata: task.metadata ?? null,
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
			targetDate: goal.targetDate?.toISOString() ?? null,
			metadata: goal.metadata ?? null,
			sensorProgress: sensorProgressMap[goal.id] ?? null
		})),
		dayChecklists: dayChecklistMap,
		dayNotes: dayNoteMap,
		dayHeadlines: dayHeadlineMap,
		activeTrips,
		spondEventsByDay,
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
		const parsed = parseListRepeatCount(text, requestedRepeats, 12);
		const repeatCount = parsed.repeatCount;

		await db.insert(checklistItems).values(
			Array.from({ length: repeatCount }, (_, index) => ({
				checklistId,
				userId,
				text: repeatCount > 1 ? `${parsed.label} (${index + 1}/${repeatCount})` : parsed.label,
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

	updateTask: async ({ request, locals }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const taskId = String(data.get('taskId') || '');
		const title = String(data.get('title') || '').trim();
		if (!taskId || !title) return fail(400, { error: 'Mangler taskId eller tittel.' });

		const task = await db.query.tasks.findFirst({
			where: eq(tasks.id, taskId),
			with: { goal: { columns: { userId: true } } }
		});
		if (!task || (task as any).goal?.userId !== userId) {
			return fail(404, { error: 'Fant ikke oppgaven.' });
		}

		await db.update(tasks).set({ title }).where(eq(tasks.id, taskId));
		return { success: true };
	},

	deleteTask: async ({ request, locals }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const taskId = String(data.get('taskId') || '');
		if (!taskId) return fail(400, { error: 'Mangler taskId.' });

		const task = await db.query.tasks.findFirst({
			where: eq(tasks.id, taskId),
			with: { goal: { columns: { userId: true } } }
		});
		if (!task || (task as any).goal?.userId !== userId) {
			return fail(404, { error: 'Fant ikke oppgaven.' });
		}

		await db.delete(tasks).where(and(eq(tasks.id, taskId)));
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
