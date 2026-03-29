import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations, themes } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getConversationsByTheme } from '$lib/server/conversations';
import { ensureUser } from '$lib/server/users';

// GET /api/tema/[id]/conversations — hent samtaler for et tema
export const GET: RequestHandler = async ({ params, locals }) => {
	await ensureUser(locals.userId);

	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId))
	});
	if (!theme) error(404, 'Tema ikke funnet');

	const list = await getConversationsByTheme(locals.userId, params.id);
	return json(list.map((c) => ({
		...c,
		updatedAt: c.updatedAt.toISOString(),
		createdAt: c.createdAt.toISOString()
	})));
};

// POST /api/tema/[id]/conversations — opprett ny samtale koblet til temaet
export const POST: RequestHandler = async ({ params, locals }) => {
	await ensureUser(locals.userId);

	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId))
	});
	if (!theme) error(404, 'Tema ikke funnet');

	let newConv: { id: string };
	try {
		[newConv] = await db.insert(conversations).values({
			userId: locals.userId,
			themeId: params.id,
			title: `${theme.name} – ${new Date().toLocaleDateString('nb-NO')}`
		}).returning({ id: conversations.id });
	} catch {
		// Fallback when theme_id column is not yet available in DB.
		[newConv] = await db.insert(conversations).values({
			userId: locals.userId,
			title: `${theme.name} – ${new Date().toLocaleDateString('nb-NO')}`
		}).returning({ id: conversations.id });
	}

	return json({ conversationId: newConv.id });
};
