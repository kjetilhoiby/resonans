import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklists, checklistItems } from '$lib/db/schema';
import { eq, isNull, and } from 'drizzle-orm';
import { USER_ID_HEADER_NAME } from '$lib/server/request-user';

// GET /api/checklists — hent aktive (ikke fullførte) sjekklister med punkter
export const GET: RequestHandler = async ({ request, url }) => {
	const userId = request.headers.get(USER_ID_HEADER_NAME) ?? 'default-user';
	const activeOnly = url.searchParams.get('active') !== 'false';

	const rows = await db.query.checklists.findMany({
		where: activeOnly
			? and(eq(checklists.userId, userId), isNull(checklists.completedAt))
			: eq(checklists.userId, userId),
		with: {
			items: {
				orderBy: (items, { asc }) => [asc(items.sortOrder), asc(items.createdAt)]
			}
		},
		orderBy: (c, { desc }) => [desc(c.createdAt)]
	});

	return json(rows);
};

// POST /api/checklists — opprett ny sjekkliste med punkter
export const POST: RequestHandler = async ({ request }) => {
	const userId = request.headers.get(USER_ID_HEADER_NAME) ?? 'default-user';
	const body = await request.json();

	const { title, emoji = '✅', context, items = [] } = body as {
		title: string;
		emoji?: string;
		context?: string;
		items?: string[];
	};

	if (!title || typeof title !== 'string') {
		return json({ error: 'title er påkrevd' }, { status: 400 });
	}

	const [checklist] = await db.insert(checklists).values({
		userId,
		title,
		emoji,
		context: context ?? null
	}).returning();

	if (items.length > 0) {
		await db.insert(checklistItems).values(
			items.map((text, i) => ({
				checklistId: checklist.id,
				userId,
				text,
				sortOrder: i
			}))
		);
	}

	// Hent ferdig sjekkliste med items
	const result = await db.query.checklists.findFirst({
		where: eq(checklists.id, checklist.id),
		with: {
			items: { orderBy: (it, { asc }) => [asc(it.sortOrder)] }
		}
	});

	return json(result, { status: 201 });
};
