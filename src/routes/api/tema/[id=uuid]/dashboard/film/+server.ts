import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes, films, filmLists } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

// GET — aggregert dashboard-summary for film-temaet
export const GET: RequestHandler = async ({ params, locals }) => {
	const userId = locals.userId;
	const themeId = params.id;

	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, themeId), eq(themes.userId, userId))
	});
	if (!theme) return new Response('Theme not found', { status: 404 });

	const filmList = await db.query.films.findMany({
		where: and(eq(films.themeId, themeId), eq(films.userId, userId)),
		columns: {
			id: true,
			title: true,
			year: true,
			director: true,
			status: true,
			rating: true,
			posterUrl: true,
			contextStatus: true,
			watchedAt: true,
			createdAt: true
		}
	});

	const listCount = await db.query.filmLists.findMany({
		where: and(eq(filmLists.themeId, themeId), eq(filmLists.userId, userId)),
		columns: { id: true }
	});

	return json({
		themeName: theme.name,
		themeEmoji: theme.emoji,
		totalFilms: filmList.length,
		wantToWatch: filmList.filter((f) => f.status === 'want_to_watch').length,
		watched: filmList.filter((f) => f.status === 'watched').length,
		listCount: listCount.length,
		films: filmList
	});
};
