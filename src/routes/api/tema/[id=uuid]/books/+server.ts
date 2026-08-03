import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { books, themes, conversations } from '$lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { enqueueBackgroundJob, processDueBackgroundJobs } from '$lib/server/background-jobs';
import { runInBackground } from '$lib/server/run-in-background';

/** Slå opp et bokomslag på OpenLibrary basert på tittel + forfatter. Returnerer null hvis ingenting matcher. */
async function lookupCoverFromOpenLibrary(title: string, author: string | null): Promise<string | null> {
	try {
		const qParts = [`title=${encodeURIComponent(title)}`];
		if (author) qParts.push(`author=${encodeURIComponent(author)}`);
		const url = `https://openlibrary.org/search.json?${qParts.join('&')}&fields=cover_i,title&limit=3`;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 5000);
		const res = await fetch(url, {
			signal: controller.signal,
			headers: { 'User-Agent': 'Resonans/1.0 (+https://resonans.app/contact)' }
		});
		clearTimeout(timer);
		if (!res.ok) return null;
		const data = (await res.json()) as { docs?: Array<{ cover_i?: number }> };
		const hit = data.docs?.find((d) => typeof d.cover_i === 'number');
		return hit?.cover_i ? `https://covers.openlibrary.org/b/id/${hit.cover_i}-M.jpg` : null;
	} catch {
		return null;
	}
}

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
	let coverUrl: string | null = typeof body?.coverUrl === 'string' && body.coverUrl.length > 0 ? body.coverUrl : null;

	if (!title) return json({ error: 'title required' }, { status: 400 });

	if (!coverUrl) {
		coverUrl = await lookupCoverFromOpenLibrary(title, author);
	}

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
			coverUrl,
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

	// Kick off processing immediately and keep it running after the response
	// is sent (waitUntil on Vercel, plain event-loop locally).
	runInBackground(processDueBackgroundJobs({ limit: 1, workerId: `book-create-${book.id}` }));

	return json(book, { status: 201 });
};
