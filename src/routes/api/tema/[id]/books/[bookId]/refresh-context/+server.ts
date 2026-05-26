import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { books, themes } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { enqueueBackgroundJob, processDueBackgroundJobs } from '$lib/server/background-jobs';
import { runInBackground } from '$lib/server/run-in-background';

// POST — re-trigger context collection for an existing book
export const POST: RequestHandler = async ({ params, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const book = await db.query.books.findFirst({
		where: and(eq(books.id, params.bookId), eq(books.userId, locals.userId)),
		columns: { id: true, title: true, author: true, contextStatus: true }
	});
	if (!book) return json({ error: 'Not found' }, { status: 404 });

	if (book.contextStatus === 'pending') {
		return json({ error: 'already_pending' }, { status: 409 });
	}

	const [updated] = await db
		.update(books)
		.set({ contextStatus: 'pending', updatedAt: new Date() })
		.where(eq(books.id, params.bookId))
		.returning();

	await enqueueBackgroundJob({
		userId: locals.userId,
		type: 'book_context_collect',
		payload: { bookId: book.id, title: book.title, author: book.author },
		priority: 1
	});

	runInBackground(processDueBackgroundJobs({ limit: 1, workerId: `book-refresh-${book.id}` }));

	return json(updated);
};
