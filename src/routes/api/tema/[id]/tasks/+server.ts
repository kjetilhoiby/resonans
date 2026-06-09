import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklistItems } from '$lib/db/schema';
import { and, eq, asc, sql } from 'drizzle-orm';
import { requireTheme, ensureProjectChecklist, mapTaskItem as mapItem } from '$lib/server/project-tasks';
import { parseTaskText } from '$lib/domains/home/task-parse';

export const GET: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	await requireTheme(userId, params.id);

	const items = await db
		.select()
		.from(checklistItems)
		.where(eq(checklistItems.themeId, params.id))
		.orderBy(asc(checklistItems.sortOrder), asc(checklistItems.createdAt));

	return json({ items: items.map(mapItem) });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	const theme = await requireTheme(userId, params.id);

	const body = await request.json().catch(() => null);
	const rawText = typeof body?.text === 'string' ? body.text.trim() : '';
	if (!rawText) throw error(400, 'Mangler oppgavetekst');

	// Parse «kjøp: X på [butikk]» → ren tekst + innkjøps-metadata.
	const parsed = parseTaskText(rawText);
	const text = parsed.text || rawText;
	const shopMeta = parsed.shopping
		? { shopping: true, ...(parsed.store ? { store: parsed.store } : {}) }
		: {};

	const parentId = typeof body?.parentId === 'string' ? body.parentId : null;
	const dueDate = typeof body?.dueDate === 'string' && body.dueDate ? body.dueDate : null;
	const startDate = typeof body?.startDate === 'string' && body.startDate ? body.startDate : null;
	const estimateMinutes = Number.isInteger(body?.estimateMinutes) ? body.estimateMinutes : null;

	const checklistId = await ensureProjectChecklist(userId, params.id, theme.name);

	// Neste sortOrder blant søsken.
	const [{ maxOrder }] = await db
		.select({ maxOrder: sql<number>`coalesce(max(${checklistItems.sortOrder}), -1)` })
		.from(checklistItems)
		.where(
			parentId
				? and(eq(checklistItems.themeId, params.id), eq(checklistItems.parentId, parentId))
				: and(eq(checklistItems.themeId, params.id), sql`${checklistItems.parentId} is null`)
		);

	const [created] = await db
		.insert(checklistItems)
		.values({
			checklistId,
			userId,
			themeId: params.id,
			parentId,
			text,
			dueDate,
			startDate,
			estimateMinutes,
			sortOrder: (maxOrder ?? -1) + 1,
			metadata: shopMeta
		})
		.returning();

	return json({ item: mapItem(created) });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	await requireTheme(userId, params.id);

	const body = await request.json().catch(() => null);
	const itemId = typeof body?.itemId === 'string' ? body.itemId : '';
	if (!itemId) throw error(400, 'Mangler itemId');

	const existing = await db.query.checklistItems.findFirst({
		where: and(eq(checklistItems.id, itemId), eq(checklistItems.themeId, params.id), eq(checklistItems.userId, userId))
	});
	if (!existing) throw error(404, 'Oppgave ikke funnet');

	const update: Partial<typeof checklistItems.$inferInsert> = {};

	if (typeof body.checked === 'boolean') {
		update.checked = body.checked;
		update.checkedAt = body.checked ? new Date() : null;
	}
	if (typeof body.text === 'string' && body.text.trim()) update.text = body.text.trim();
	if ('dueDate' in body) update.dueDate = body.dueDate || null;
	if ('startDate' in body) update.startDate = body.startDate || null;
	if ('estimateMinutes' in body) {
		update.estimateMinutes = Number.isInteger(body.estimateMinutes) ? body.estimateMinutes : null;
	}
	if (Number.isInteger(body.sortOrder)) update.sortOrder = body.sortOrder;
	if (Array.isArray(body.blockedBy)) {
		const meta = (existing.metadata ?? {}) as Record<string, unknown>;
		update.metadata = { ...meta, blockedBy: body.blockedBy.filter((x: unknown) => typeof x === 'string') };
	}

	if (Object.keys(update).length === 0) return json({ item: mapItem(existing) });

	const [updated] = await db
		.update(checklistItems)
		.set(update)
		.where(eq(checklistItems.id, itemId))
		.returning();

	return json({ item: mapItem(updated) });
};

export const DELETE: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	await requireTheme(userId, params.id);

	const body = await request.json().catch(() => null);
	const itemId = typeof body?.itemId === 'string' ? body.itemId : '';
	if (!itemId) throw error(400, 'Mangler itemId');

	// onDelete: 'cascade' på parentId fjerner underoppgaver automatisk.
	await db
		.delete(checklistItems)
		.where(and(eq(checklistItems.id, itemId), eq(checklistItems.themeId, params.id), eq(checklistItems.userId, userId)));

	return json({ ok: true });
};
