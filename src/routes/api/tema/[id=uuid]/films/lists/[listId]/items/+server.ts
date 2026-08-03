import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { filmLists, filmListItems } from '$lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';

// POST — legg til et element i lista (lett TMDB-snapshot)
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const list = await db.query.filmLists.findFirst({
		where: and(eq(filmLists.id, params.listId), eq(filmLists.userId, locals.userId)),
		columns: { id: true }
	});
	if (!list) return json({ error: 'Not found' }, { status: 404 });

	const body = await request.json().catch(() => null);
	const title = typeof body?.title === 'string' ? body.title.trim() : '';
	if (!title) return json({ error: 'title required' }, { status: 400 });

	// Neste posisjon = maks + 1
	const [{ maxPos }] = await db
		.select({ maxPos: sql<number>`COALESCE(MAX(${filmListItems.position}), -1)` })
		.from(filmListItems)
		.where(eq(filmListItems.listId, params.listId));

	const [item] = await db
		.insert(filmListItems)
		.values({
			listId: params.listId,
			userId: locals.userId,
			tmdbId: typeof body?.tmdbId === 'number' ? body.tmdbId : null,
			filmId: typeof body?.filmId === 'string' ? body.filmId : null,
			title,
			year: typeof body?.year === 'number' ? body.year : null,
			posterUrl: typeof body?.posterUrl === 'string' ? body.posterUrl : null,
			runtime: typeof body?.runtime === 'number' ? body.runtime : null,
			position: Number(maxPos) + 1
		})
		.returning();

	return json(item, { status: 201 });
};
