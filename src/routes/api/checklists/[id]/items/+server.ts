import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklistItems, checklists } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { parseListRepeatCount } from '$lib/server/list-repeat-parser';

// POST /api/checklists/[id]/items — legg til et nytt punkt
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	const { text, sortOrder = 9999, count = 1 } = await request.json() as {
		text: string;
		sortOrder?: number;
		count?: number;
	};

	if (!text) return json({ error: 'text er påkrevd' }, { status: 400 });

	const parsed = parseListRepeatCount(text, count || 1, 12);
	const repeatCount = parsed.repeatCount;

	const createdItems = await db.insert(checklistItems).values(
		Array.from({ length: repeatCount }, (_, index) => ({
			checklistId: params.id,
			userId,
			text: repeatCount > 1 ? `${parsed.label} (${index + 1}/${repeatCount})` : parsed.label,
			sortOrder: sortOrder + index
		}))
	).returning();

	return json(createdItems, { status: 201 });
};
