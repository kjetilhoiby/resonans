import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklistItems, checklists } from '$lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { USER_ID_HEADER_NAME } from '$lib/server/request-user';

// POST /api/checklists/[id]/items — legg til et nytt punkt
export const POST: RequestHandler = async ({ params, request }) => {
	const userId = request.headers.get(USER_ID_HEADER_NAME) ?? 'default-user';
	const { text, sortOrder = 9999 } = await request.json() as { text: string; sortOrder?: number };

	if (!text) return json({ error: 'text er påkrevd' }, { status: 400 });

	const [item] = await db.insert(checklistItems).values({
		checklistId: params.id,
		userId,
		text,
		sortOrder
	}).returning();

	return json(item, { status: 201 });
};
