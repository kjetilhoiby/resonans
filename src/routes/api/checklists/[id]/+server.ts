import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklists } from '$lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { USER_ID_HEADER_NAME } from '$lib/server/request-user';

// PATCH /api/checklists/[id] — oppdater tittel, emoji, eller merk som fullført
export const PATCH: RequestHandler = async ({ params, request }) => {
	const userId = request.headers.get(USER_ID_HEADER_NAME) ?? 'default-user';
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
export const DELETE: RequestHandler = async ({ params, request }) => {
	const userId = request.headers.get(USER_ID_HEADER_NAME) ?? 'default-user';

	const deleted = await db
		.delete(checklists)
		.where(and(eq(checklists.id, params.id), eq(checklists.userId, userId)))
		.returning();

	if (!deleted.length) return json({ error: 'Ikke funnet' }, { status: 404 });
	return json({ ok: true });
};
