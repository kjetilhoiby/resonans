import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { books, bookClips, themes, bookProgressLog } from '$lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';

// GET — book detail + clips
export const GET: RequestHandler = async ({ params, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const book = await db.query.books.findFirst({
		where: and(eq(books.id, params.bookId), eq(books.userId, locals.userId)),
		with: { clips: { orderBy: (c, { desc }) => [desc(c.createdAt)] } }
	});
	if (!book) return json({ error: 'Not found' }, { status: 404 });

	return json(book);
};

// PATCH — update progress, status, or context pack
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const book = await db.query.books.findFirst({
		where: and(eq(books.id, params.bookId), eq(books.userId, locals.userId)),
		columns: { id: true, totalPages: true }
	});
	if (!book) return json({ error: 'Not found' }, { status: 404 });

	const body = await request.json().catch(() => null);
	const updates: Partial<typeof books.$inferInsert> = {};

	if (typeof body?.currentPage === 'number') updates.currentPage = body.currentPage;
	if (typeof body?.totalPages === 'number') updates.totalPages = body.totalPages;
	if (typeof body?.currentMinutes === 'number') updates.currentMinutes = body.currentMinutes;
	if (typeof body?.totalMinutes === 'number') updates.totalMinutes = body.totalMinutes;
	if (typeof body?.format === 'string' && ['print', 'audio', 'both'].includes(body.format)) updates.format = body.format;
	if (typeof body?.status === 'string') {
		const validStatuses = ['not_started', 'reading', 'completed', 'paused'];
		if (!validStatuses.includes(body.status)) {
			return json({ error: 'invalid status' }, { status: 400 });
		}
		updates.status = body.status;
		if (body.status === 'reading' && !body.startedAt) {
			updates.startedAt = new Date();
		}
		if (body.status === 'completed' && !body.finishedAt) {
			updates.finishedAt = new Date();
		}
	}
	if (body?.contextPack !== undefined) updates.contextPack = body.contextPack;
	if (typeof body?.contextStatus === 'string') updates.contextStatus = body.contextStatus;
	if (typeof body?.author === 'string') updates.author = body.author;
	if (typeof body?.coverUrl === 'string') updates.coverUrl = body.coverUrl;

	updates.updatedAt = new Date();

	const [updated] = await db
		.update(books)
		.set(updates)
		.where(eq(books.id, params.bookId))
		.returning();

	// Log progress snapshot if page or minutes changed
	if (updates.currentPage !== undefined || updates.currentMinutes !== undefined) {
		await db.insert(bookProgressLog).values({
			bookId: params.bookId,
			userId: locals.userId,
			currentPage: updates.currentPage ?? updated.currentPage,
			currentMinutes: updates.currentMinutes ?? updated.currentMinutes
		});
	}

	return json(updated);
};

// DELETE — remove a book
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const book = await db.query.books.findFirst({
		where: and(eq(books.id, params.bookId), eq(books.userId, locals.userId)),
		columns: { id: true }
	});
	if (!book) return json({ error: 'Not found' }, { status: 404 });

	await db.delete(books).where(eq(books.id, params.bookId));
	return json({ deleted: true });
};
