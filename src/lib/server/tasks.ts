import { db } from '$lib/db';
import { checklists, checklistItems, themes } from '$lib/db/schema';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

export type TaskBucket = 'innboks' | 'gjores' | 'ugjort';
export type TaskThemeFilter = 'all' | 'none' | string;

export interface TaskFilters {
	bucket?: TaskBucket;
	theme?: TaskThemeFilter;
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

/**
 * SQL-fragment som er sant når items hører til en day-plan-sjekkliste
 * vis context-format `week:YYYY-WNN:day:YYYY-MM-DD`, og dato-delen er
 * sammenlignet med today.
 */
function dayContextDateCompare(op: '<' | '>=', today: string) {
	// `right(context, 10)` plukker ut YYYY-MM-DD fra slutten.
	if (op === '<') {
		return sql`${checklists.context} LIKE 'week:%:day:%' AND right(${checklists.context}, 10) < ${today}`;
	}
	return sql`${checklists.context} LIKE 'week:%:day:%' AND right(${checklists.context}, 10) >= ${today}`;
}

export async function listTasks(userId: string, filters: TaskFilters = {}): Promise<UnifiedTask[]> {
	const bucket = filters.bucket ?? 'innboks';
	const theme = filters.theme ?? 'all';

	const conditions = [
		eq(checklistItems.userId, userId),
		isNull(checklistItems.parentId),
		isNull(checklistItems.skippedAt),
		isNull(checklists.completedAt),
		eq(checklistItems.checked, false)
	];

	const today = todayIsoLocal();
	const overdueSql = sql`(${checklistItems.dueDate} IS NOT NULL AND ${checklistItems.dueDate} < ${today})`;
	const pastDayContext = dayContextDateCompare('<', today);
	const futureDayContext = dayContextDateCompare('>=', today);
	const ugjortSql = sql`(${overdueSql} OR ${pastDayContext})`;

	if (bucket === 'ugjort') {
		conditions.push(ugjortSql);
	} else if (bucket === 'innboks') {
		// Innboks er stedsbasert: items i checklist med context = 'inbox'.
		// Items i andre lister (custom, week-plan, månedsplan osv.) tilhører Gjøres.
		conditions.push(eq(checklists.context, 'inbox'));
		conditions.push(sql`NOT ${ugjortSql}`);
	} else if (bucket === 'gjores') {
		// Gjøres = items utenfor inbox, ikke forfalt og ikke i framtidig day-plan.
		// `IS DISTINCT FROM` inkluderer NULL-context (sjekklister uten kontekst).
		conditions.push(sql`${checklists.context} IS DISTINCT FROM 'inbox'`);
		conditions.push(sql`NOT ${ugjortSql}`);
		conditions.push(sql`NOT (${futureDayContext})`);
	}

	if (theme === 'none') {
		conditions.push(isNull(checklistItems.themeId));
	} else if (theme !== 'all') {
		conditions.push(eq(checklistItems.themeId, theme));
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

/**
 * Teller items i hver av de tre buckets samtidig i én query.
 * Buckets er gjensidig utelukkende, så et item kan kun være i én av dem.
 */
export async function countTasksByBucket(
	userId: string
): Promise<{ innboks: number; gjores: number; ugjort: number }> {
	const today = todayIsoLocal();
	const overdueSql = sql`(${checklistItems.dueDate} IS NOT NULL AND ${checklistItems.dueDate} < ${today})`;
	const pastDayContext = sql`${checklists.context} LIKE 'week:%:day:%' AND right(${checklists.context}, 10) < ${today}`;
	const futureDayContext = sql`${checklists.context} LIKE 'week:%:day:%' AND right(${checklists.context}, 10) >= ${today}`;
	const ugjortSql = sql`(${overdueSql} OR ${pastDayContext})`;

	const rows = await db
		.select({
			ugjort: sql<number>`count(*) filter (where ${ugjortSql})::int`,
			innboks: sql<number>`count(*) filter (where NOT ${ugjortSql} AND ${checklists.context} = 'inbox')::int`,
			gjores: sql<number>`count(*) filter (where NOT ${ugjortSql} AND ${checklists.context} IS DISTINCT FROM 'inbox' AND NOT (${futureDayContext}))::int`
		})
		.from(checklistItems)
		.innerJoin(checklists, eq(checklistItems.checklistId, checklists.id))
		.where(
			and(
				eq(checklistItems.userId, userId),
				eq(checklistItems.checked, false),
				isNull(checklistItems.parentId),
				isNull(checklistItems.skippedAt),
				isNull(checklists.completedAt)
			)
		);

	const r = rows[0];
	return {
		innboks: r?.innboks ?? 0,
		gjores: r?.gjores ?? 0,
		ugjort: r?.ugjort ?? 0
	};
}

/** Bakover-kompatibel: returnerer kun innboks-count. Brukes av sort-inbox chip. */
export async function countUnsortedTasks(userId: string): Promise<number> {
	const counts = await countTasksByBucket(userId);
	return counts.innboks;
}
