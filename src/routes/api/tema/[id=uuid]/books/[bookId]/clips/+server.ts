import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { books, bookClips } from '$lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';

// GET — list clips for a book
export const GET: RequestHandler = async ({ params, locals }) => {
	const book = await db.query.books.findFirst({
		where: and(eq(books.id, params.bookId), eq(books.userId, locals.userId)),
		columns: { id: true }
	});
	if (!book) return json({ error: 'Not found' }, { status: 404 });

	const clips = await db
		.select()
		.from(bookClips)
		.where(and(eq(bookClips.bookId, params.bookId), eq(bookClips.userId, locals.userId)))
		.orderBy(desc(bookClips.createdAt));

	return json(clips);
};

// POST — add a clip/excerpt
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const book = await db.query.books.findFirst({
		where: and(eq(books.id, params.bookId), eq(books.userId, locals.userId)),
		columns: { id: true }
	});
	if (!book) return json({ error: 'Not found' }, { status: 404 });

	const body = await request.json().catch(() => null);
	const text = typeof body?.text === 'string' ? body.text.trim() : '';
	if (!text) return json({ error: 'text required' }, { status: 400 });

	const page = typeof body?.page === 'number' ? body.page : null;
	const position = typeof body?.position === 'string' ? body.position.trim() : null;
	const note = typeof body?.note === 'string' ? body.note.trim() : null;
	const source = typeof body?.source === 'string' ? body.source.trim() : null;
	const audioUrl = typeof body?.audioUrl === 'string' ? body.audioUrl.trim() : null;
	const characters = Array.isArray(body?.characters)
		? (body.characters as unknown[]).filter((c): c is string => typeof c === 'string')
		: null;

	const [clip] = await db
		.insert(bookClips)
		.values({
			bookId: params.bookId,
			userId: locals.userId,
			text,
			page: page || null,
			position: position || null,
			note: note || null,
			source: source || null,
			audioUrl: audioUrl || null,
			characters: characters ?? undefined
		})
		.returning();

	return json(clip, { status: 201 });
};
