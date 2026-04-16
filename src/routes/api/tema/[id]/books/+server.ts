import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { books, themes, conversations } from '$lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { enqueueBackgroundJob, processDueBackgroundJobs } from '$lib/server/background-jobs';

// GET — list all books for a theme
export const GET: RequestHandler = async ({ params, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const rows = await db
		.select()
		.from(books)
		.where(and(eq(books.themeId, params.id), eq(books.userId, locals.userId)))
		.orderBy(asc(books.createdAt));

	return json(rows);
};

// POST — create a new book (and trigger async context collection)
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const body = await request.json().catch(() => null);
	const title = typeof body?.title === 'string' ? body.title.trim() : '';
	const author = typeof body?.author === 'string' ? body.author.trim() : null;
	const totalPages = typeof body?.totalPages === 'number' ? body.totalPages : null;
	const totalMinutes = typeof body?.totalMinutes === 'number' ? body.totalMinutes : null;
	const format = (typeof body?.format === 'string' && ['print', 'audio', 'both'].includes(body.format))
		? (body.format as 'print' | 'audio' | 'both')
		: 'print';

	if (!title) return json({ error: 'title required' }, { status: 400 });

	// Create a dedicated conversation for this book
	const [conv] = await db
		.insert(conversations)
		.values({
			userId: locals.userId,
			themeId: params.id,
			title: `📖 ${title}${author ? ` — ${author}` : ''}`
		})
		.returning({ id: conversations.id });

	const [book] = await db
		.insert(books)
		.values({
			themeId: params.id,
			userId: locals.userId,
			title,
			author: author || null,
			totalPages: totalPages || null,
			totalMinutes: totalMinutes || null,
			format,
			conversationId: conv.id,
			contextStatus: 'pending'
		})
		.returning();

	// Queue async context collection job, then kick off processing immediately
	await enqueueBackgroundJob({
		userId: locals.userId,
		type: 'book_context_collect',
		payload: { bookId: book.id, title, author: author || null },
		priority: 1
	});

	// Fire-and-forget: process now without blocking the response
	void processDueBackgroundJobs({ limit: 1, workerId: `book-create-${book.id}` });

	return json(book, { status: 201 });
};
