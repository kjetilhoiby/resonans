import { db } from '$lib/db';
import { checklists, checklistItems } from '$lib/db/schema';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';

export const INBOX_CONTEXT = 'inbox';
const INBOX_TITLE = 'Innboks';

export async function getOrCreateInboxChecklist(userId: string): Promise<string> {
	const existing = await db.query.checklists.findFirst({
		where: and(eq(checklists.userId, userId), eq(checklists.context, INBOX_CONTEXT)),
		columns: { id: true }
	});
	if (existing) return existing.id;

	const [created] = await db
		.insert(checklists)
		.values({ userId, title: INBOX_TITLE, context: INBOX_CONTEXT })
		.returning({ id: checklists.id });
	return created.id;
}

export async function addInboxItems(userId: string, texts: string[]): Promise<string[]> {
	const clean = texts.map((t) => t.trim()).filter((t) => t.length > 0);
	if (clean.length === 0) return [];

	const checklistId = await getOrCreateInboxChecklist(userId);

	const maxRow = await db
		.select({ sortOrder: checklistItems.sortOrder })
		.from(checklistItems)
		.where(eq(checklistItems.checklistId, checklistId))
		.orderBy(desc(checklistItems.sortOrder))
		.limit(1);
	let nextSort = (maxRow[0]?.sortOrder ?? -1) + 1;

	const inserted = await db
		.insert(checklistItems)
		.values(
			clean.map((text) => ({
				userId,
				checklistId,
				text,
				sortOrder: nextSort++
			}))
		)
		.returning({ id: checklistItems.id });

	return inserted.map((r) => r.id);
}

export interface InboxItem {
	id: string;
	text: string;
	createdAt: Date;
}

export async function listInboxItems(userId: string): Promise<InboxItem[]> {
	const checklist = await db.query.checklists.findFirst({
		where: and(eq(checklists.userId, userId), eq(checklists.context, INBOX_CONTEXT)),
		columns: { id: true }
	});
	if (!checklist) return [];

	const rows = await db
		.select({
			id: checklistItems.id,
			text: checklistItems.text,
			createdAt: checklistItems.createdAt
		})
		.from(checklistItems)
		.where(
			and(
				eq(checklistItems.checklistId, checklist.id),
				eq(checklistItems.checked, false),
				isNull(checklistItems.parentId),
				isNull(checklistItems.skippedAt)
			)
		)
		.orderBy(asc(checklistItems.sortOrder), asc(checklistItems.createdAt));

	return rows;
}

export async function countInboxItems(userId: string): Promise<number> {
	const items = await listInboxItems(userId);
	return items.length;
}
