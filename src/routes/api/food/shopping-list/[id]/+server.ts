import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { shoppingLists } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

// PATCH /api/food/shopping-list/[id] — oppdater items (avhuking/redigering) og status
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const userId = locals.userId;
	const body = await request.json();

	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (Array.isArray(body.items)) updates.items = body.items;
	if (body.status === 'draft' || body.status === 'final') updates.status = body.status;

	const [updated] = await db
		.update(shoppingLists)
		.set(updates)
		.where(and(eq(shoppingLists.id, params.id), eq(shoppingLists.userId, userId)))
		.returning();

	if (!updated) return json({ error: 'Not found' }, { status: 404 });
	return json({ shoppingList: updated });
};
