import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { cutLists } from '$lib/db/schema';
import { and, eq, asc, sql } from 'drizzle-orm';
import { requireTheme } from '$lib/server/project-tasks';
import { sanitizeRows } from '$lib/kappliste/rows';

function mapCutList(row: typeof cutLists.$inferSelect) {
	return {
		id: row.id,
		title: row.title,
		boardLengthCm: row.boardLengthCm,
		kerfMm: row.kerfMm,
		rows: row.rows ?? [],
		sortOrder: row.sortOrder,
		updatedAt: row.updatedAt.toISOString()
	};
}

export const GET: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	await requireTheme(userId, params.id);

	const lists = await db
		.select()
		.from(cutLists)
		.where(and(eq(cutLists.themeId, params.id), eq(cutLists.userId, userId)))
		.orderBy(asc(cutLists.sortOrder), asc(cutLists.createdAt));

	return json({ cutLists: lists.map(mapCutList) });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	await requireTheme(userId, params.id);

	const body = await request.json().catch(() => null);
	const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 80) : 'Kappliste';
	const boardLengthCm = Number.isFinite(body?.boardLengthCm) && body.boardLengthCm > 0 ? Math.round(body.boardLengthCm) : 390;
	const kerfMm = Number.isFinite(body?.kerfMm) && body.kerfMm >= 0 ? Math.round(body.kerfMm) : 0;
	const rows = sanitizeRows(body?.rows);

	const [{ maxOrder }] = await db
		.select({ maxOrder: sql<number>`coalesce(max(${cutLists.sortOrder}), -1)` })
		.from(cutLists)
		.where(and(eq(cutLists.themeId, params.id), eq(cutLists.userId, userId)));

	const [created] = await db
		.insert(cutLists)
		.values({ userId, themeId: params.id, title, boardLengthCm, kerfMm, rows, sortOrder: (maxOrder ?? -1) + 1 })
		.returning();

	return json({ cutList: mapCutList(created) });
};
