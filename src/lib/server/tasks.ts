import { db } from '$lib/db';
import { checklists, checklistItems, themes } from '$lib/db/schema';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';

export type TaskStatusFilter = 'open' | 'done' | 'all';
export type TaskTimeframeFilter =
	| 'overdue'
	| 'today'
	| 'this_week'
	| 'next_week'
	| 'dated'
	| 'inbox'
	| 'all';
export type TaskThemeFilter = 'all' | 'none' | string;

export interface TaskFilters {
	status?: TaskStatusFilter;
	timeframe?: TaskTimeframeFilter;
	theme?: TaskThemeFilter;
	unsortedOnly?: boolean;
}

export interface TaskSubItem {
	id: string;
	text: string;
	checked: boolean;
}

export interface UnifiedTask {
	id: string;
	text: string;
	checked: boolean;
	estimateMinutes: number | null;
	dueDate: string | null;
	startDate: string | null;
	endDate: string | null;
	themeId: string | null;
	themeName: string | null;
	themeEmoji: string | null;
	checklistId: string;
	checklistTitle: string;
	checklistContext: string | null;
	createdAt: Date;
	subItems: TaskSubItem[];
	isUnsorted: boolean;
}

function todayIsoLocal(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isoOffset(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() + days);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nextMondayIso(): string {
	const d = new Date();
	const dow = d.getDay();
	const delta = (1 - dow + 7) % 7 || 7;
	d.setDate(d.getDate() + delta);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function endOfThisWeekIso(): string {
	// Søndag denne uka
	const d = new Date();
	const dow = d.getDay();
	const delta = dow === 0 ? 0 : 7 - dow;
	d.setDate(d.getDate() + delta);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function endOfNextWeekIso(): string {
	return isoOffset(14 - new Date().getDay());
}

export async function listTasks(userId: string, filters: TaskFilters = {}): Promise<UnifiedTask[]> {
	const status = filters.status ?? 'open';
	const timeframe = filters.timeframe ?? 'all';
	const theme = filters.theme ?? 'all';
	const unsortedOnly = filters.unsortedOnly === true;

	const conditions = [
		eq(checklistItems.userId, userId),
		isNull(checklistItems.parentId),
		isNull(checklistItems.skippedAt),
		isNull(checklists.completedAt)
	];

	if (status === 'open') conditions.push(eq(checklistItems.checked, false));
	if (status === 'done') conditions.push(eq(checklistItems.checked, true));

	const today = todayIsoLocal();
	if (timeframe === 'overdue') {
		conditions.push(isNotNull(checklistItems.dueDate));
		conditions.push(lt(checklistItems.dueDate, today));
	} else if (timeframe === 'today') {
		conditions.push(eq(checklistItems.dueDate, today));
	} else if (timeframe === 'this_week') {
		conditions.push(isNotNull(checklistItems.dueDate));
		conditions.push(gte(checklistItems.dueDate, today));
		conditions.push(lte(checklistItems.dueDate, endOfThisWeekIso()));
	} else if (timeframe === 'next_week') {
		conditions.push(isNotNull(checklistItems.dueDate));
		conditions.push(gte(checklistItems.dueDate, nextMondayIso()));
		conditions.push(lte(checklistItems.dueDate, endOfNextWeekIso()));
	} else if (timeframe === 'dated') {
		// Har dato: dueDate satt ELLER hører til en tidsplassert sjekkliste
		// (day-/week-/month-plan har kontekst-strenger som "week:..." eller "...:day:...").
		conditions.push(
			or(
				isNotNull(checklistItems.dueDate),
				sql`${checklists.context} LIKE 'week:%'`,
				sql`${checklists.context} LIKE '%:day:%'`,
				sql`${checklists.context} LIKE 'month:%'`
			)!
		);
	} else if (timeframe === 'inbox') {
		// I innboks: explicit inbox-context, ingen plan-tilknytning.
		conditions.push(eq(checklists.context, 'inbox'));
	}

	if (theme === 'none') {
		conditions.push(isNull(checklistItems.themeId));
	} else if (theme !== 'all') {
		conditions.push(eq(checklistItems.themeId, theme));
	}

	if (unsortedOnly) {
		// «Usortert» = mangler estimat OG (mangler tema ELLER mangler frist).
		// Brukes hovedsakelig for innboks-flowen.
		conditions.push(isNull(checklistItems.estimateMinutes));
	}

	const rows = await db
		.select({
			id: checklistItems.id,
			text: checklistItems.text,
			checked: checklistItems.checked,
			estimateMinutes: checklistItems.estimateMinutes,
			dueDate: checklistItems.dueDate,
			startDate: checklistItems.startDate,
			endDate: checklistItems.endDate,
			themeId: checklistItems.themeId,
			themeName: themes.name,
			themeEmoji: themes.emoji,
			checklistId: checklistItems.checklistId,
			checklistTitle: checklists.title,
			checklistContext: checklists.context,
			createdAt: checklistItems.createdAt
		})
		.from(checklistItems)
		.innerJoin(checklists, eq(checklistItems.checklistId, checklists.id))
		.leftJoin(themes, eq(checklistItems.themeId, themes.id))
		.where(and(...conditions))
		.orderBy(
			sql`${checklistItems.dueDate} IS NULL`,
			asc(checklistItems.dueDate),
			desc(checklistItems.createdAt)
		);

	if (rows.length === 0) return [];

	const ids = rows.map((r) => r.id);
	const childRows = await db
		.select({
			parentId: checklistItems.parentId,
			id: checklistItems.id,
			text: checklistItems.text,
			checked: checklistItems.checked,
			sortOrder: checklistItems.sortOrder
		})
		.from(checklistItems)
		.where(
			and(
				eq(checklistItems.userId, userId),
				isNotNull(checklistItems.parentId),
				inArray(checklistItems.parentId, ids)
			)
		);

	const childMap = new Map<string, TaskSubItem[]>();
	for (const c of childRows) {
		if (!c.parentId) continue;
		const arr = childMap.get(c.parentId) ?? [];
		arr.push({ id: c.id, text: c.text, checked: c.checked });
		childMap.set(c.parentId, arr);
	}
	for (const [k, arr] of childMap) {
		arr.sort((a, b) => a.text.localeCompare(b.text, 'nb-NO'));
		childMap.set(k, arr);
	}

	return rows.map((r) => ({
		id: r.id,
		text: r.text,
		checked: r.checked,
		estimateMinutes: r.estimateMinutes,
		dueDate: r.dueDate,
		startDate: r.startDate,
		endDate: r.endDate,
		themeId: r.themeId,
		themeName: r.themeName,
		themeEmoji: r.themeEmoji,
		checklistId: r.checklistId,
		checklistTitle: r.checklistTitle,
		checklistContext: r.checklistContext,
		createdAt: r.createdAt,
		subItems: childMap.get(r.id) ?? [],
		isUnsorted: r.estimateMinutes === null
	}));
}

export interface TaskPatch {
	text?: string;
	estimateMinutes?: number | null;
	dueDate?: string | null;
	themeId?: string | null;
	checked?: boolean;
}

async function ownsTask(userId: string, taskId: string): Promise<boolean> {
	const row = await db.query.checklistItems.findFirst({
		where: and(eq(checklistItems.id, taskId), eq(checklistItems.userId, userId)),
		columns: { id: true }
	});
	return !!row;
}

export async function updateTask(userId: string, taskId: string, patch: TaskPatch): Promise<boolean> {
	if (!(await ownsTask(userId, taskId))) return false;
	const update: Record<string, unknown> = {};
	if (patch.text !== undefined) update.text = patch.text.trim();
	if (patch.estimateMinutes !== undefined) update.estimateMinutes = patch.estimateMinutes;
	if (patch.dueDate !== undefined) update.dueDate = patch.dueDate;
	if (patch.themeId !== undefined) update.themeId = patch.themeId;
	if (patch.checked !== undefined) {
		update.checked = patch.checked;
		update.checkedAt = patch.checked ? new Date() : null;
	}
	if (Object.keys(update).length === 0) return true;
	await db
		.update(checklistItems)
		.set(update)
		.where(and(eq(checklistItems.id, taskId), eq(checklistItems.userId, userId)));
	return true;
}

export async function deleteTask(userId: string, taskId: string): Promise<boolean> {
	if (!(await ownsTask(userId, taskId))) return false;
	await db
		.delete(checklistItems)
		.where(and(eq(checklistItems.id, taskId), eq(checklistItems.userId, userId)));
	return true;
}

export async function setTaskBreakdown(
	userId: string,
	taskId: string,
	subTexts: string[]
): Promise<TaskSubItem[]> {
	const parentRow = await db.query.checklistItems.findFirst({
		where: and(eq(checklistItems.id, taskId), eq(checklistItems.userId, userId)),
		columns: { id: true, checklistId: true }
	});
	if (!parentRow) return [];

	await db
		.delete(checklistItems)
		.where(
			and(eq(checklistItems.parentId, taskId), eq(checklistItems.userId, userId))
		);

	const clean = subTexts.map((t) => t.trim()).filter((t) => t.length > 0);
	if (clean.length === 0) return [];

	const inserted = await db
		.insert(checklistItems)
		.values(
			clean.map((text, i) => ({
				userId,
				checklistId: parentRow.checklistId,
				parentId: taskId,
				text,
				sortOrder: i
			}))
		)
		.returning({
			id: checklistItems.id,
			text: checklistItems.text,
			checked: checklistItems.checked
		});

	return inserted;
}

export async function countUnsortedTasks(userId: string): Promise<number> {
	const rows = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(checklistItems)
		.innerJoin(checklists, eq(checklistItems.checklistId, checklists.id))
		.where(
			and(
				eq(checklistItems.userId, userId),
				eq(checklistItems.checked, false),
				isNull(checklistItems.parentId),
				isNull(checklistItems.skippedAt),
				isNull(checklists.completedAt),
				isNull(checklistItems.estimateMinutes),
				or(eq(checklists.context, 'inbox'), isNull(checklistItems.themeId))
			)
		);
	return rows[0]?.count ?? 0;
}
