import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { films, filmClips } from '$lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';

// GET — list clips/notes for a film
export const GET: RequestHandler = async ({ params, locals }) => {
	const film = await db.query.films.findFirst({
		where: and(eq(films.id, params.filmId), eq(films.userId, locals.userId)),
		columns: { id: true }
	});
	if (!film) return json({ error: 'Not found' }, { status: 404 });

	const clips = await db
		.select()
		.from(filmClips)
		.where(and(eq(filmClips.filmId, params.filmId), eq(filmClips.userId, locals.userId)))
		.orderBy(desc(filmClips.createdAt));

	return json(clips);
};

// POST — add a clip (scene/quote/note)
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const film = await db.query.films.findFirst({
		where: and(eq(films.id, params.filmId), eq(films.userId, locals.userId)),
		columns: { id: true }
	});
	if (!film) return json({ error: 'Not found' }, { status: 404 });

	const body = await request.json().catch(() => null);
	const text = typeof body?.text === 'string' ? body.text.trim() : '';
	if (!text) return json({ error: 'text required' }, { status: 400 });

	const timestamp = typeof body?.timestamp === 'string' ? body.timestamp.trim() : null;
	const note = typeof body?.note === 'string' ? body.note.trim() : null;
	const source = typeof body?.source === 'string' ? body.source.trim() : null;

	const [clip] = await db
		.insert(filmClips)
		.values({
			filmId: params.filmId,
			userId: locals.userId,
			text,
			timestamp: timestamp || null,
			note: note || null,
			source: source || null
		})
		.returning();

	return json(clip, { status: 201 });
};
