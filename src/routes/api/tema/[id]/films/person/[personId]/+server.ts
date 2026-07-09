import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getPersonFilmography } from '$lib/server/integrations/tmdb';

// GET — en persons filmografi (?role=director|actor). Brukes til auto-lister.
export const GET: RequestHandler = async ({ params, url, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const personId = Number(params.personId);
	if (!Number.isFinite(personId)) return json({ error: 'invalid personId' }, { status: 400 });

	const roleParam = url.searchParams.get('role');
	const role = roleParam === 'director' || roleParam === 'actor' ? roleParam : undefined;

	const filmography = await getPersonFilmography(personId, { role });
	if (!filmography) return json({ error: 'not found or TMDB unavailable' }, { status: 404 });

	return json(filmography);
};
