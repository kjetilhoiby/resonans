import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themeLists, themes } from '$lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params, locals }) => {
	// Verify theme ownership
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const lists = await db.query.themeLists.findMany({
		where: and(eq(themeLists.themeId, params.id), eq(themeLists.userId, locals.userId)),
		with: { items: { orderBy: (i, { asc }) => [asc(i.sortOrder), asc(i.createdAt)] } },
		orderBy: [asc(themeLists.sortOrder), asc(themeLists.createdAt)]
	});

	return json(lists);
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const body = await request.json().catch(() => null);
	const title = typeof body?.title === 'string' ? body.title.trim() : '';
	const emoji = typeof body?.emoji === 'string' ? body.emoji.slice(0, 8) : '📝';
	const listType = typeof body?.listType === 'string' ? body.listType : 'general';

	if (!title) return json({ error: 'title required' }, { status: 400 });

	const [created] = await db
		.insert(themeLists)
		.values({ themeId: params.id, userId: locals.userId, title, emoji, listType })
		.returning();

	return json(created);
};
