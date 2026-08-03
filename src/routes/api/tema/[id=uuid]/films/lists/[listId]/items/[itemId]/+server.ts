import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { filmListItems } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

// DELETE — fjern et element fra lista
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const item = await db.query.filmListItems.findFirst({
		where: and(eq(filmListItems.id, params.itemId), eq(filmListItems.userId, locals.userId)),
		columns: { id: true }
	});
	if (!item) return json({ error: 'Not found' }, { status: 404 });

	await db.delete(filmListItems).where(eq(filmListItems.id, params.itemId));
	return json({ deleted: true });
};
