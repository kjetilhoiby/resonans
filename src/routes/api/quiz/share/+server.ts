import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { quizSessions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { resolveRequestUserId } from '$lib/server/request-user';
import { getOrCreateQuizShareToken, buildShareUrl } from '$lib/server/share-tokens';
import type { RequestHandler } from './$types';

/**
 * Lag (eller gjenbruk) en delelenke til den aktive quizen, så scoreboardet kan vises på
 * et eget nettbrett i baksetet. Driveren av spillskjermens «del»-knapp.
 */
export const POST: RequestHandler = async (event) => {
	const userId = await resolveRequestUserId(event);
	const rows = await db
		.select({ id: quizSessions.id })
		.from(quizSessions)
		.where(and(eq(quizSessions.userId, userId), eq(quizSessions.active, true)))
		.limit(1);
	if (!rows[0]) throw error(409, 'Ingen aktiv quiz å dele.');

	const token = await getOrCreateQuizShareToken(userId, rows[0].id);
	return json({ token: token.token, url: buildShareUrl(event.url.origin, token.token) });
};
