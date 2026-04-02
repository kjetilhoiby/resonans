import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklistItems, checklists } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

function parseRepeatCount(raw: string): { count: number; label: string } {
	const text = raw.trim();
	const match = text.match(/^(\d{1,2})\s+(.+)$/);
	if (!match) return { count: 1, label: text };

	const count = Number.parseInt(match[1], 10);
	if (!Number.isFinite(count) || count < 1 || count > 12) {
		return { count: 1, label: text };
	}

	return { count, label: match[2].trim() };
}

// POST /api/checklists/[id]/items — legg til et nytt punkt
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	const { text, sortOrder = 9999, count = 1 } = await request.json() as {
		text: string;
		sortOrder?: number;
		count?: number;
	};

	if (!text) return json({ error: 'text er påkrevd' }, { status: 400 });

	const parsed = parseRepeatCount(text);
	const repeatCount = Math.min(Math.max(parsed.count, count || 1), 12);

	const createdItems = await db.insert(checklistItems).values(
		Array.from({ length: repeatCount }, (_, index) => ({
			checklistId: params.id,
			userId,
			text: repeatCount > 1 ? `${parsed.label} (${index + 1}/${repeatCount})` : text,
			sortOrder: sortOrder + index
		}))
	).returning();

	return json(createdItems, { status: 201 });
};
