import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { storySessions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { resolveRequestUserId } from '$lib/server/request-user';
import { getOrCreateStoryShareToken, buildShareUrl } from '$lib/server/share-tokens';
import type { RequestHandler } from './$types';

/**
 * Lag (eller gjenbruk) en delelenke til den aktive fortellingen, så world + siste avsnitt kan
 * vises på et eget nettbrett i baksetet. `url` eies av Resonans og brukes UENDRET av appen.
 * 409 hvis ingen aktiv fortelling. Speiler /api/quiz/share.
 */
export const POST: RequestHandler = async (event) => {
	const userId = await resolveRequestUserId(event);
	const rows = await db
		.select({ id: storySessions.id })
		.from(storySessions)
		.where(and(eq(storySessions.userId, userId), eq(storySessions.active, true)))
		.limit(1);
	if (!rows[0]) throw error(409, 'Ingen aktiv fortelling å dele.');

	const token = await getOrCreateStoryShareToken(userId, rows[0].id);
	return json({ token: token.token, url: buildShareUrl(event.url.origin, token.token) });
};
