import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themeLists } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

// DELETE /api/tema/[id]/lists/[listId]
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const list = await db.query.themeLists.findFirst({
		where: and(eq(themeLists.id, params.listId), eq(themeLists.userId, locals.userId)),
		columns: { id: true }
	});
	if (!list) return json({ error: 'Not found' }, { status: 404 });

	await db.delete(themeLists).where(eq(themeLists.id, params.listId));
	return json({ success: true });
};
