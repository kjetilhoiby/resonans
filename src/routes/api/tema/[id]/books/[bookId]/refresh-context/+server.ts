import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { books, themes, backgroundJobs } from '$lib/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { enqueueBackgroundJob, processDueBackgroundJobs } from '$lib/server/background-jobs';
import { runInBackground } from '$lib/server/run-in-background';

// POST — re-trigger context collection for an existing book.
// Lov til å kalles selv om contextStatus === 'pending': da kicker vi
// bare worker-en på nytt i tilfelle jobben sitter i kø. Hvis jobben
// allerede kjører gjør vi ingenting destruktivt.
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

	const [latestJob] = await db
		.select({ id: backgroundJobs.id, status: backgroundJobs.status })
		.from(backgroundJobs)
		.where(
			and(
				eq(backgroundJobs.type, 'book_context_collect'),
				sql`${backgroundJobs.payload}->>'bookId' = ${params.bookId}`
			)
		)
		.orderBy(desc(backgroundJobs.createdAt))
		.limit(1);

	const hasQueuedJob =
		book.contextStatus === 'pending' &&
		latestJob &&
		(latestJob.status === 'queued' || latestJob.status === 'retry' || latestJob.status === 'running');

	if (hasQueuedJob) {
		// Eksisterende jobb finnes — bare kick worker-en, ikke lag duplikat.
		runInBackground(
			processDueBackgroundJobs({ limit: 1, workerId: `book-rekick-${book.id}` })
		);
		const [current] = await db
			.select()
			.from(books)
			.where(eq(books.id, params.bookId));
		return json({ ...current, action: 'rekicked' });
	}

	// Ingen kjørende jobb — sett pending og lag en ny.
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

	runInBackground(
		processDueBackgroundJobs({ limit: 1, workerId: `book-refresh-${book.id}` })
	);

	return json({ ...updated, action: 'requeued' });
};
