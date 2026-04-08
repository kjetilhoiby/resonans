import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themeListItems, themeLists } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

// POST /api/tema/[id]/lists/[listId]/items
export const POST: RequestHandler = async ({ params, request, locals }) => {
	// Verify list ownership
	const list = await db.query.themeLists.findFirst({
		where: and(eq(themeLists.id, params.listId), eq(themeLists.userId, locals.userId)),
		columns: { id: true }
	});
	if (!list) return json({ error: 'Not found' }, { status: 404 });

	const body = await request.json().catch(() => null);
	const text = typeof body?.text === 'string' ? body.text.trim() : '';
	if (!text) return json({ error: 'text required' }, { status: 400 });

	const itemDate = typeof body?.itemDate === 'string' ? body.itemDate : null;
	const notes = typeof body?.notes === 'string' ? body.notes.trim() || null : null;

	const [item] = await db
		.insert(themeListItems)
		.values({ listId: params.listId, userId: locals.userId, text, itemDate, notes })
		.returning();

	return json(item);
};
