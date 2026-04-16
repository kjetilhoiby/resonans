import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { bookClips, books } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

// DELETE — remove a specific clip
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const book = await db.query.books.findFirst({
		where: and(eq(books.id, params.bookId), eq(books.userId, locals.userId)),
		columns: { id: true }
	});
	if (!book) return json({ error: 'Not found' }, { status: 404 });

	const clip = await db.query.bookClips.findFirst({
		where: and(eq(bookClips.id, params.clipId), eq(bookClips.userId, locals.userId)),
		columns: { id: true }
	});
	if (!clip) return json({ error: 'Not found' }, { status: 404 });

	await db.delete(bookClips).where(eq(bookClips.id, params.clipId));
	return json({ deleted: true });
};
