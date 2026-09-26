import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes, filmLists, filmListItems } from '$lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { getPersonFilmography } from '$lib/server/integrations/tmdb';

// GET — alle lister for temaet, med antall elementer
export const GET: RequestHandler = async ({ params, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const lists = await db.query.filmLists.findMany({
		where: and(eq(filmLists.themeId, params.id), eq(filmLists.userId, locals.userId)),
		with: { items: { orderBy: (i, { asc }) => [asc(i.position), asc(i.addedAt)] } },
		orderBy: (l, { asc }) => [asc(l.createdAt)]
	});

	return json(lists);
};

// POST — opprett en liste. Med kind 'director'|'actor' + tmdbPersonId
// auto-fylles listen fra personens filmografi (lette snapshots). En manuell
// liste kan få med seg `items` — et utvalg fra en filmografi («best vurdert»,
// «tverrsnitt») blir da én liste i ett kall framfor N innsettinger.
const MAX_INITIAL_ITEMS = 50;
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const body = await request.json().catch(() => null);
	const name = typeof body?.name === 'string' ? body.name.trim() : '';
	if (!name) return json({ error: 'name required' }, { status: 400 });

	const kind = ['manual', 'director', 'actor', 'watchlist'].includes(body?.kind)
		? (body.kind as 'manual' | 'director' | 'actor' | 'watchlist')
		: 'manual';
	const description = typeof body?.description === 'string' ? body.description.trim() || null : null;
	const tmdbPersonId = typeof body?.tmdbPersonId === 'number' ? body.tmdbPersonId : null;
	// Felt for felt, aldri en spread: en kolonne lagt til senere skal ikke kunne
	// fylles fra en forespørselskropp ingen validerte.
	const initialItems = Array.isArray(body?.items)
		? (body.items as unknown[])
				.filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
				.filter((i) => typeof i.title === 'string' && i.title.trim())
				.slice(0, MAX_INITIAL_ITEMS)
				.map((i) => ({
					tmdbId: typeof i.tmdbId === 'number' ? i.tmdbId : null,
					title: (i.title as string).trim(),
					year: typeof i.year === 'number' ? i.year : null,
					posterUrl: typeof i.posterUrl === 'string' && i.posterUrl ? i.posterUrl : null
				}))
		: [];

	const [list] = await db
		.insert(filmLists)
		.values({
			themeId: params.id,
			userId: locals.userId,
			name,
			description,
			kind,
			tmdbPersonId
		})
		.returning();

	// Auto-fyll fra filmografi ved regissør-/skuespiller-liste
	if ((kind === 'director' || kind === 'actor') && tmdbPersonId) {
		try {
			const filmography = await getPersonFilmography(tmdbPersonId, { role: kind });
			if (filmography?.films.length) {
				await db.insert(filmListItems).values(
					filmography.films.map((f, idx) => ({
						listId: list.id,
						userId: locals.userId,
						tmdbId: f.tmdbId,
						title: f.title,
						year: f.year ?? null,
						posterUrl: f.posterUrl ?? null,
						position: idx
					}))
				);
			}
		} catch {
			// Ikke-fatalt — lista opprettes tom, kan fylles manuelt
		}
	} else if (initialItems.length) {
		await db.insert(filmListItems).values(
			initialItems.map((item, idx) => ({ listId: list.id, userId: locals.userId, ...item, position: idx }))
		);
	}

	const created = await db.query.filmLists.findFirst({
		where: eq(filmLists.id, list.id),
		with: { items: { orderBy: (i, { asc }) => [asc(i.position)] } }
	});

	return json(created, { status: 201 });
};
