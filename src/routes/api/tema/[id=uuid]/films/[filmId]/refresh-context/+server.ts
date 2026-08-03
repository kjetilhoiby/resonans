import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { films, themes, backgroundJobs } from '$lib/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { enqueueBackgroundJob, processBackgroundJobById } from '$lib/server/background-jobs';
import { runInBackground } from '$lib/server/run-in-background';

// POST — re-trigger context collection for an existing film (speiler bok-ruten).
export const POST: RequestHandler = async ({ params, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const film = await db.query.films.findFirst({
		where: and(eq(films.id, params.filmId), eq(films.userId, locals.userId)),
		columns: { id: true, tmdbId: true, title: true, director: true, year: true, contextStatus: true }
	});
	if (!film) return json({ error: 'Not found' }, { status: 404 });

	const [latestJob] = await db
		.select({ id: backgroundJobs.id, status: backgroundJobs.status })
		.from(backgroundJobs)
		.where(
			and(
				eq(backgroundJobs.type, 'film_context_collect'),
				sql`${backgroundJobs.payload}->>'filmId' = ${params.filmId}`
			)
		)
		.orderBy(desc(backgroundJobs.createdAt))
		.limit(1);

	if (latestJob?.status === 'running') {
		const [current] = await db.select().from(films).where(eq(films.id, params.filmId));
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
			type: 'film_context_collect',
			payload: {
				filmId: film.id,
				tmdbId: film.tmdbId,
				title: film.title,
				director: film.director,
				year: film.year
			},
			priority: 1
		});
		jobIdToRun = newJob.id;
		action = 'requeued';
	}

	const [updated] = await db
		.update(films)
		.set({ contextStatus: 'pending', updatedAt: new Date() })
		.where(eq(films.id, params.filmId))
		.returning();

	runInBackground(processBackgroundJobById(jobIdToRun, `film-inline-${film.id}`));

	return json({ ...updated, action });
};
