import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes, goals, memories } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

// PATCH /api/tema/[id] — soft-arkivering (skjuler temaet, data beholdes).
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json().catch(() => null);
	const archived = body?.archived;
	if (typeof archived !== 'boolean') {
		return json({ error: 'archived (boolean) kreves' }, { status: 400 });
	}

	const res = await db
		.update(themes)
		.set({ archived, updatedAt: new Date() })
		.where(and(eq(themes.id, params.id), eq(themes.userId, locals.userId)))
		.returning({ id: themes.id });

	if (res.length === 0) return json({ error: 'Not found' }, { status: 404 });
	return json({ success: true });
};

// DELETE /api/tema/[id] — permanent sletting. De fleste avhengighetene har
// ON DELETE CASCADE / SET NULL i skjemaet og rydder seg selv. goals og memories
// refererer themes uten onDelete (RESTRICT), så de nulles eksplisitt først.
// neon-http støtter ikke transaksjoner, så stegene kjøres sekvensielt.
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const existing = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!existing) return json({ error: 'Not found' }, { status: 404 });

	await db
		.update(goals)
		.set({ themeId: null })
		.where(and(eq(goals.themeId, params.id), eq(goals.userId, locals.userId)));
	await db
		.update(memories)
		.set({ themeId: null })
		.where(and(eq(memories.themeId, params.id), eq(memories.userId, locals.userId)));
	await db.delete(themes).where(and(eq(themes.id, params.id), eq(themes.userId, locals.userId)));

	return json({ success: true });
};
