import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { cutLists } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireTheme } from '$lib/server/project-tasks';
import { sanitizeMaterials } from '$lib/kappliste/rows';

function mapCutList(row: typeof cutLists.$inferSelect) {
	return {
		id: row.id,
		title: row.title,
		kerfMm: row.kerfMm,
		transportMaxLengthMm: row.transportMaxLengthMm,
		transportMaxWidthMm: row.transportMaxWidthMm,
		materials: row.materials ?? [],
		sortOrder: row.sortOrder,
		updatedAt: row.updatedAt.toISOString()
	};
}

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	await requireTheme(userId, params.id);

	const existing = await db.query.cutLists.findFirst({
		where: and(eq(cutLists.id, params.listId), eq(cutLists.themeId, params.id), eq(cutLists.userId, userId))
	});
	if (!existing) throw error(404, 'Kappliste ikke funnet');

	const body = await request.json().catch(() => null);
	const update: Partial<typeof cutLists.$inferInsert> = { updatedAt: new Date() };

	if (typeof body?.title === 'string' && body.title.trim()) update.title = body.title.trim().slice(0, 80);
	if (Number.isFinite(body?.kerfMm) && body.kerfMm >= 0) update.kerfMm = Math.min(body.kerfMm, 50);
	if (Number.isFinite(body?.transportMaxLengthMm) && body.transportMaxLengthMm > 0)
		update.transportMaxLengthMm = Math.min(body.transportMaxLengthMm, 10000);
	if (Number.isFinite(body?.transportMaxWidthMm) && body.transportMaxWidthMm > 0)
		update.transportMaxWidthMm = Math.min(body.transportMaxWidthMm, 10000);
	if (Number.isInteger(body?.sortOrder)) update.sortOrder = body.sortOrder;
	if ('materials' in (body ?? {})) update.materials = sanitizeMaterials(body.materials);

	const [updated] = await db
		.update(cutLists)
		.set(update)
		.where(eq(cutLists.id, params.listId))
		.returning();

	return json({ cutList: mapCutList(updated) });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	await requireTheme(userId, params.id);

	await db
		.delete(cutLists)
		.where(and(eq(cutLists.id, params.listId), eq(cutLists.themeId, params.id), eq(cutLists.userId, userId)));

	return json({ ok: true });
};
