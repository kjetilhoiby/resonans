import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themeListItems } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

// PATCH /api/tema/[id]/lists/[listId]/items/[itemId]
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const item = await db.query.themeListItems.findFirst({
		where: and(eq(themeListItems.id, params.itemId), eq(themeListItems.userId, locals.userId)),
		columns: { id: true }
	});
	if (!item) return json({ error: 'Not found' }, { status: 404 });

	const body = await request.json().catch(() => null);
	const updates: Partial<{ checked: boolean; notes: string | null; text: string; checkedAt: Date | null }> = {};

	if (typeof body?.checked === 'boolean') {
		updates.checked = body.checked;
		updates.checkedAt = body.checked ? new Date() : null;
	}
	if (typeof body?.text === 'string') updates.text = body.text.trim();
	if ('notes' in body) updates.notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;

	await db.update(themeListItems).set(updates).where(eq(themeListItems.id, params.itemId));
	return json({ success: true });
};

// DELETE /api/tema/[id]/lists/[listId]/items/[itemId]
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const item = await db.query.themeListItems.findFirst({
		where: and(eq(themeListItems.id, params.itemId), eq(themeListItems.userId, locals.userId)),
		columns: { id: true }
	});
	if (!item) return json({ error: 'Not found' }, { status: 404 });

	await db.delete(themeListItems).where(eq(themeListItems.id, params.itemId));
	return json({ success: true });
};
