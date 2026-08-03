import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { books, themes, backgroundJobs } from '$lib/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import {
	enqueueBackgroundJob,
	processBackgroundJobById
} from '$lib/server/background-jobs';
import { runInBackground } from '$lib/server/run-in-background';

// POST — re-trigger context collection for an existing book.
//
// Tar ansvar for kjøringen direkte: enten gjenbruker en aktiv jobb eller
// lager en ny, og kaller `processBackgroundJobById` via `waitUntil` så
// kjøringen skjer i denne request-en (ikke via queue-worker).
//
// Lov til å kalles selv om contextStatus === 'pending': hvis siste jobb
// fortsatt er queued/retry, claimer vi den og kjører nå. Hvis den allerede
// kjører returnerer vi action: 'already_running' (no-op).
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

	if (latestJob?.status === 'running') {
		const [current] = await db
			.select()
			.from(books)
			.where(eq(books.id, params.bookId));
		return json({ ...current, action: 'already_running' });
	}

	let jobIdToRun: string;
	let action: 'rekicked' | 'requeued';

	if (latestJob && (latestJob.status === 'queued' || latestJob.status === 'retry')) {
		jobIdToRun = latestJob.id;
		action = 'rekicked';
	} else {
		const newJob = await enqueueBackgroundJob({
			userId: locals.userId,
			type: 'book_context_collect',
			payload: { bookId: book.id, title: book.title, author: book.author },
			priority: 1
		});
		jobIdToRun = newJob.id;
		action = 'requeued';
	}

	const [updated] = await db
		.update(books)
		.set({ contextStatus: 'pending', updatedAt: new Date() })
		.where(eq(books.id, params.bookId))
		.returning();

	// Vi eier kjøringen: claim spesifikk jobb og kjør den nå. waitUntil
	// holder funksjonen i live på Vercel til collectoren er ferdig.
	runInBackground(processBackgroundJobById(jobIdToRun, `book-inline-${book.id}`));

	return json({ ...updated, action });
};
