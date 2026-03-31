import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklists } from '$lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

// PATCH /api/checklists/[id] — oppdater tittel, emoji, eller merk som fullført
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	const body = await request.json() as {
		title?: string;
		emoji?: string;
		completedAt?: string | null;
	};

	const updates: Record<string, unknown> = {};
	if (body.title !== undefined) updates.title = body.title;
	if (body.emoji !== undefined) updates.emoji = body.emoji;
	if ('completedAt' in body) {
		updates.completedAt = body.completedAt ? new Date(body.completedAt) : null;
	}

	const [updated] = await db
		.update(checklists)
		.set(updates)
		.where(and(eq(checklists.id, params.id), eq(checklists.userId, userId)))
		.returning();

	if (!updated) return json({ error: 'Ikke funnet' }, { status: 404 });
	return json(updated);
};

// DELETE /api/checklists/[id]
export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;

	const deleted = await db
		.delete(checklists)
		.where(and(eq(checklists.id, params.id), eq(checklists.userId, userId)))
		.returning();

	if (!deleted.length) return json({ error: 'Ikke funnet' }, { status: 404 });
	return json({ ok: true });
};
