import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { books, bookProgressLog } from '$lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';

// GET — full progress history for a book
export const GET: RequestHandler = async ({ params, locals }) => {
	const book = await db.query.books.findFirst({
		where: and(eq(books.id, params.bookId), eq(books.userId, locals.userId)),
		columns: { id: true }
	});
	if (!book) return json({ error: 'Not found' }, { status: 404 });

	const log = await db
		.select()
		.from(bookProgressLog)
		.where(eq(bookProgressLog.bookId, params.bookId))
		.orderBy(asc(bookProgressLog.loggedAt));

	return json(log);
};
