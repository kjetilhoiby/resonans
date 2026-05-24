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

export interface InboxSubItem {
	id: string;
	text: string;
	checked: boolean;
	sortOrder: number;
}

export interface InboxItem {
	id: string;
	text: string;
	createdAt: Date;
	estimateMinutes: number | null;
	dueDate: string | null;
	themeId: string | null;
	subItems: InboxSubItem[];
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
			createdAt: checklistItems.createdAt,
			estimateMinutes: checklistItems.estimateMinutes,
			dueDate: checklistItems.dueDate,
			themeId: checklistItems.themeId,
			parentId: checklistItems.parentId,
			checked: checklistItems.checked,
			sortOrder: checklistItems.sortOrder
		})
		.from(checklistItems)
		.where(
			and(
				eq(checklistItems.checklistId, checklist.id),
				isNull(checklistItems.skippedAt)
			)
		)
		.orderBy(asc(checklistItems.sortOrder), asc(checklistItems.createdAt));

	const byParent = new Map<string, typeof rows>();
	const roots: typeof rows = [];
	for (const r of rows) {
		if (r.parentId) {
			const arr = byParent.get(r.parentId) ?? [];
			arr.push(r);
			byParent.set(r.parentId, arr);
		} else if (!r.checked) {
			roots.push(r);
		}
	}

	return roots.map((r) => ({
		id: r.id,
		text: r.text,
		createdAt: r.createdAt,
		estimateMinutes: r.estimateMinutes,
		dueDate: r.dueDate,
		themeId: r.themeId,
		subItems: (byParent.get(r.id) ?? [])
			.sort((a, b) => a.sortOrder - b.sortOrder)
			.map((c) => ({ id: c.id, text: c.text, checked: c.checked, sortOrder: c.sortOrder }))
	}));
}

export interface InboxItemPatch {
	text?: string;
	estimateMinutes?: number | null;
	dueDate?: string | null;
	themeId?: string | null;
}

async function assertInboxItem(userId: string, itemId: string): Promise<string | null> {
	const row = await db.query.checklistItems.findFirst({
		where: and(eq(checklistItems.id, itemId), eq(checklistItems.userId, userId)),
		columns: { id: true, checklistId: true }
	});
	if (!row) return null;
	const checklist = await db.query.checklists.findFirst({
		where: and(eq(checklists.id, row.checklistId), eq(checklists.context, INBOX_CONTEXT)),
		columns: { id: true }
	});
	return checklist ? row.checklistId : null;
}

export async function updateInboxItem(
	userId: string,
	itemId: string,
	patch: InboxItemPatch
): Promise<boolean> {
	if (!(await assertInboxItem(userId, itemId))) return false;
	const update: Record<string, unknown> = {};
	if (patch.text !== undefined) update.text = patch.text.trim();
	if (patch.estimateMinutes !== undefined) update.estimateMinutes = patch.estimateMinutes;
	if (patch.dueDate !== undefined) update.dueDate = patch.dueDate;
	if (patch.themeId !== undefined) update.themeId = patch.themeId;
	if (Object.keys(update).length === 0) return true;
	await db
		.update(checklistItems)
		.set(update)
		.where(and(eq(checklistItems.id, itemId), eq(checklistItems.userId, userId)));
	return true;
}

export async function deleteInboxItem(userId: string, itemId: string): Promise<boolean> {
	if (!(await assertInboxItem(userId, itemId))) return false;
	await db
		.delete(checklistItems)
		.where(and(eq(checklistItems.id, itemId), eq(checklistItems.userId, userId)));
	return true;
}

export async function setInboxBreakdown(
	userId: string,
	itemId: string,
	subTexts: string[]
): Promise<InboxSubItem[]> {
	const checklistId = await assertInboxItem(userId, itemId);
	if (!checklistId) return [];

	await db
		.delete(checklistItems)
		.where(and(eq(checklistItems.parentId, itemId), eq(checklistItems.userId, userId)));

	const clean = subTexts.map((t) => t.trim()).filter((t) => t.length > 0);
	if (clean.length === 0) return [];

	const inserted = await db
		.insert(checklistItems)
		.values(
			clean.map((text, i) => ({
				userId,
				checklistId,
				parentId: itemId,
				text,
				sortOrder: i
			}))
		)
		.returning({
			id: checklistItems.id,
			text: checklistItems.text,
			checked: checklistItems.checked,
			sortOrder: checklistItems.sortOrder
		});

	return inserted;
}

export async function countInboxItems(userId: string): Promise<number> {
	const items = await listInboxItems(userId);
	return items.length;
}
