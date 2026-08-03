import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes, books } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params, locals }) => {
	const userId = locals.userId;
	const themeId = params.id;

	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, themeId), eq(themes.userId, userId))
	});

	if (!theme) {
		return new Response('Theme not found', { status: 404 });
	}

	const bookList = await db.query.books.findMany({
		where: and(eq(books.themeId, themeId), eq(books.userId, userId)),
		columns: {
			id: true,
			title: true,
			author: true,
			status: true,
			currentPage: true,
			totalPages: true,
			contextStatus: true,
			startedAt: true,
			finishedAt: true,
			createdAt: true
		}
	});

	return json({
		themeName: theme.name,
		themeEmoji: theme.emoji,
		totalBooks: bookList.length,
		reading: bookList.filter((b) => b.status === 'reading').length,
		completed: bookList.filter((b) => b.status === 'completed').length,
		books: bookList
	});
};
