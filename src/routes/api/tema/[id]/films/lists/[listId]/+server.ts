import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { filmLists } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

async function ownedList(listId: string, userId: string) {
	return db.query.filmLists.findFirst({
		where: and(eq(filmLists.id, listId), eq(filmLists.userId, userId)),
		columns: { id: true }
	});
}

// GET — én liste med elementer
export const GET: RequestHandler = async ({ params, locals }) => {
	const list = await db.query.filmLists.findFirst({
		where: and(eq(filmLists.id, params.listId), eq(filmLists.userId, locals.userId)),
		with: { items: { orderBy: (i, { asc }) => [asc(i.position), asc(i.addedAt)] } }
	});
	if (!list) return json({ error: 'Not found' }, { status: 404 });
	return json(list);
};

// PATCH — endre navn/beskrivelse
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!(await ownedList(params.listId, locals.userId))) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const body = await request.json().catch(() => null);
	const updates: Partial<typeof filmLists.$inferInsert> = {};
	if (typeof body?.name === 'string' && body.name.trim()) updates.name = body.name.trim();
	if (body?.description !== undefined) {
		updates.description = typeof body.description === 'string' ? body.description.trim() || null : null;
	}
	updates.updatedAt = new Date();

	const [updated] = await db
		.update(filmLists)
		.set(updates)
		.where(eq(filmLists.id, params.listId))
		.returning();

	return json(updated);
};

// DELETE — slett liste (elementer kaskaderes)
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!(await ownedList(params.listId, locals.userId))) {
		return json({ error: 'Not found' }, { status: 404 });
	}
	await db.delete(filmLists).where(eq(filmLists.id, params.listId));
	return json({ deleted: true });
};
