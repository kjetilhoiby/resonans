import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { films, themes, conversations } from '$lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { enqueueBackgroundJob, processDueBackgroundJobs } from '$lib/server/background-jobs';
import { runInBackground } from '$lib/server/run-in-background';
import { getFilmDetails } from '$lib/server/integrations/tmdb';

// GET — list all films for a theme
export const GET: RequestHandler = async ({ params, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const rows = await db
		.select()
		.from(films)
		.where(and(eq(films.themeId, params.id), eq(films.userId, locals.userId)))
		.orderBy(asc(films.createdAt));

	return json(rows);
};

// POST — create a film (and trigger async context collection). Enriches the
// immediately-visible fields from TMDB best-effort; full context comes later.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const body = await request.json().catch(() => null);
	const title = typeof body?.title === 'string' ? body.title.trim() : '';
	if (!title) return json({ error: 'title required' }, { status: 400 });

	const tmdbId = typeof body?.tmdbId === 'number' ? body.tmdbId : null;
	const status = body?.status === 'watched' ? 'watched' : 'want_to_watch';

	// Startverdier fra klienten (fra søketreffet)
	let director = typeof body?.director === 'string' ? body.director : null;
	let year = typeof body?.year === 'number' ? body.year : null;
	let runtime = typeof body?.runtime === 'number' ? body.runtime : null;
	let posterUrl = typeof body?.posterUrl === 'string' && body.posterUrl ? body.posterUrl : null;
	let backdropUrl = typeof body?.backdropUrl === 'string' && body.backdropUrl ? body.backdropUrl : null;
	let overview = typeof body?.overview === 'string' ? body.overview : null;
	let originalTitle = typeof body?.originalTitle === 'string' ? body.originalTitle : null;
	let genres: string[] | null = Array.isArray(body?.genres) ? body.genres : null;
	let cast: Array<{ name: string; character?: string }> | null = null;

	// Best-effort berikelse fra TMDB (fyller feltene biblioteket viser umiddelbart)
	if (tmdbId) {
		try {
			const details = await getFilmDetails(tmdbId);
			if (details) {
				director = director ?? details.director ?? null;
				year = year ?? details.year ?? null;
				runtime = runtime ?? details.runtime ?? null;
				posterUrl = posterUrl ?? details.posterUrl ?? null;
				backdropUrl = backdropUrl ?? details.backdropUrl ?? null;
				overview = overview ?? details.overview ?? null;
				originalTitle = originalTitle ?? details.originalTitle ?? null;
				genres = genres ?? (details.genres.length ? details.genres : null);
				cast = details.cast.length ? details.cast : null;
			}
		} catch {
			// Ikke-fatalt — kontekstjobben prøver igjen
		}
	}

	// Egen samtale for filmen
	const [conv] = await db
		.insert(conversations)
		.values({
			userId: locals.userId,
			themeId: params.id,
			title: `🎬 ${title}${year ? ` (${year})` : ''}`
		})
		.returning({ id: conversations.id });

	const [film] = await db
		.insert(films)
		.values({
			themeId: params.id,
			userId: locals.userId,
			tmdbId,
			title,
			originalTitle,
			year,
			director,
			runtime,
			posterUrl,
			backdropUrl,
			overview,
			genres: genres ?? undefined,
			cast: cast ?? undefined,
			status,
			watchedAt: status === 'watched' ? new Date() : null,
			conversationId: conv.id,
			contextStatus: 'pending'
		})
		.returning();

	await enqueueBackgroundJob({
		userId: locals.userId,
		type: 'film_context_collect',
		payload: { filmId: film.id, tmdbId, title, director, year },
		priority: 1
	});

	runInBackground(processDueBackgroundJobs({ limit: 1, workerId: `film-create-${film.id}` }));

	return json(film, { status: 201 });
};
