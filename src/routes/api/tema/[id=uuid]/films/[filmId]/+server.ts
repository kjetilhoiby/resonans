import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { films, themes, backgroundJobs } from '$lib/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

// GET — film detail + clips (+ context job progress if pending)
export const GET: RequestHandler = async ({ params, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const film = await db.query.films.findFirst({
		where: and(eq(films.id, params.filmId), eq(films.userId, locals.userId)),
		with: { clips: { orderBy: (c, { desc }) => [desc(c.createdAt)] } }
	});
	if (!film) return json({ error: 'Not found' }, { status: 404 });

	let contextProgress: unknown = null;
	if (film.contextStatus === 'pending') {
		const [latestJob] = await db
			.select({
				status: backgroundJobs.status,
				result: backgroundJobs.result,
				error: backgroundJobs.error,
				updatedAt: backgroundJobs.updatedAt
			})
			.from(backgroundJobs)
			.where(
				and(
					eq(backgroundJobs.type, 'film_context_collect'),
					sql`${backgroundJobs.payload}->>'filmId' = ${params.filmId}`
				)
			)
			.orderBy(desc(backgroundJobs.createdAt))
			.limit(1);

		if (latestJob) {
			const result = (latestJob.result ?? {}) as { progress?: unknown };
			contextProgress = {
				jobStatus: latestJob.status,
				jobError: latestJob.error,
				progress: result.progress ?? null
			};
		}
	}

	return json({ ...film, contextProgress });
};

// PATCH — update status, rating, review note, or context pack
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const film = await db.query.films.findFirst({
		where: and(eq(films.id, params.filmId), eq(films.userId, locals.userId)),
		columns: { id: true }
	});
	if (!film) return json({ error: 'Not found' }, { status: 404 });

	const body = await request.json().catch(() => null);
	const updates: Partial<typeof films.$inferInsert> = {};

	if (typeof body?.status === 'string') {
		const validStatuses = ['want_to_watch', 'watched'];
		if (!validStatuses.includes(body.status)) {
			return json({ error: 'invalid status' }, { status: 400 });
		}
		updates.status = body.status;
		// Sett watchedAt første gang filmen markeres som sett
		if (body.status === 'watched') {
			updates.watchedAt = body.watchedAt ? new Date(body.watchedAt) : new Date();
		} else {
			updates.watchedAt = null;
		}
	}
	if (body?.rating !== undefined) {
		if (body.rating === null) {
			updates.rating = null;
		} else if (typeof body.rating === 'number' && body.rating >= 1 && body.rating <= 6) {
			updates.rating = Math.round(body.rating);
		} else {
			return json({ error: 'rating must be 1-6' }, { status: 400 });
		}
	}
	if (body?.reviewNote !== undefined) {
		updates.reviewNote = typeof body.reviewNote === 'string' ? body.reviewNote.trim() || null : null;
	}
	if (body?.contextPack !== undefined) updates.contextPack = body.contextPack;
	if (typeof body?.contextStatus === 'string') updates.contextStatus = body.contextStatus;

	updates.updatedAt = new Date();

	const [updated] = await db
		.update(films)
		.set(updates)
		.where(eq(films.id, params.filmId))
		.returning();

	return json(updated);
};

// DELETE — remove a film
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const film = await db.query.films.findFirst({
		where: and(eq(films.id, params.filmId), eq(films.userId, locals.userId)),
		columns: { id: true }
	});
	if (!film) return json({ error: 'Not found' }, { status: 404 });

	await db.delete(films).where(eq(films.id, params.filmId));
	return json({ deleted: true });
};
