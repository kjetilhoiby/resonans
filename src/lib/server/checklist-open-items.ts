import { db } from '$lib/db';
import { checklists, checklistItems } from '$lib/db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';

export interface OpenChecklistItem {
	id: string;
	text: string;
	checklistId: string;
	checklistTitle: string;
	checklistContext: string | null;
	priorityBucket: 'today' | 'inbox' | 'week' | 'month' | 'other';
}

export interface OpenItemsSummary {
	count: number;
	items: OpenChecklistItem[];
}

function bucketForContext(context: string | null, todayIso: string): OpenChecklistItem['priorityBucket'] {
	if (context === 'inbox') return 'inbox';
	if (!context) return 'other';
	if (context.endsWith(`:day:${todayIso}`)) return 'today';
	if (context.startsWith('week:') && !context.includes(':day:')) return 'week';
	if (context.startsWith('month:')) return 'month';
	return 'other';
}

const BUCKET_ORDER: Record<OpenChecklistItem['priorityBucket'], number> = {
	today: 0,
	inbox: 1,
	week: 2,
	month: 3,
	other: 4
};

export async function loadOpenChecklistItems(
	userId: string,
	todayIso: string,
	limit = 20
): Promise<OpenChecklistItem[]> {
	const rows = await db
		.select({
			itemId: checklistItems.id,
			itemText: checklistItems.text,
			itemSortOrder: checklistItems.sortOrder,
			checklistId: checklists.id,
			checklistTitle: checklists.title,
			checklistContext: checklists.context
		})
		.from(checklistItems)
		.innerJoin(checklists, eq(checklistItems.checklistId, checklists.id))
		.where(
			and(
				eq(checklistItems.userId, userId),
				eq(checklistItems.checked, false),
				isNull(checklistItems.parentId),
				isNull(checklistItems.skippedAt),
				isNull(checklists.completedAt),
				sql`(${checklistItems.snoozedToDate} IS NULL OR ${checklistItems.snoozedToDate} <= ${todayIso})`
			)
		);

	const items: OpenChecklistItem[] = rows.map((r) => ({
		id: r.itemId,
		text: r.itemText,
		checklistId: r.checklistId,
		checklistTitle: r.checklistTitle,
		checklistContext: r.checklistContext,
		priorityBucket: bucketForContext(r.checklistContext, todayIso)
	}));

	items.sort((a, b) => {
		const diff = BUCKET_ORDER[a.priorityBucket] - BUCKET_ORDER[b.priorityBucket];
		if (diff !== 0) return diff;
		return a.text.localeCompare(b.text, 'nb-NO');
	});

	return items.slice(0, limit);
}

export async function countOpenChecklistItems(userId: string, todayIso: string): Promise<number> {
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
				sql`(${checklistItems.snoozedToDate} IS NULL OR ${checklistItems.snoozedToDate} <= ${todayIso})`
			)
		);
	return rows[0]?.count ?? 0;
}
