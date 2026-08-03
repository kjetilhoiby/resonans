import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { searchPerson, isTmdbConfigured } from '$lib/server/integrations/tmdb';

// GET — søk etter person (regissør/skuespiller) i TMDB (?q=...)
export const GET: RequestHandler = async ({ params, url, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const q = url.searchParams.get('q')?.trim() ?? '';
	if (!q) return json({ results: [], configured: isTmdbConfigured() });

	const results = await searchPerson(q);
	return json({ results, configured: isTmdbConfigured() });
};
