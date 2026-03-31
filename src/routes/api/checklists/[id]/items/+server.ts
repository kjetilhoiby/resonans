import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklistItems, checklists } from '$lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

// POST /api/checklists/[id]/items — legg til et nytt punkt
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
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
