import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklistItems, checklists } from '$lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

// PATCH /api/checklists/[id]/items/[itemId] — toggle checked / endre tekst
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	const body = await request.json() as { checked?: boolean; text?: string };

	const updates: Record<string, unknown> = {};
	if (body.text !== undefined) updates.text = body.text;
	if (body.checked !== undefined) {
		updates.checked = body.checked;
		updates.checkedAt = body.checked ? new Date() : null;
	}

	const [updated] = await db
		.update(checklistItems)
		.set(updates)
		.where(and(
			eq(checklistItems.id, params.itemId),
			eq(checklistItems.userId, userId)
		))
		.returning();

	if (!updated) return json({ error: 'Ikke funnet' }, { status: 404 });

	// Sjekk om alle punkter i listen er avkrysset → merk listen som fullført
	const remaining = await db.query.checklistItems.findMany({
		where: and(
			eq(checklistItems.checklistId, params.id),
			eq(checklistItems.checked, false)
		)
	});

	if (remaining.length === 0 && body.checked) {
		await db
			.update(checklists)
			.set({ completedAt: new Date() })
			.where(and(
				eq(checklists.id, params.id),
				isNull(checklists.completedAt)
			));
	}

	return json(updated);
};

// DELETE /api/checklists/[id]/items/[itemId]
export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;

	const deleted = await db
		.delete(checklistItems)
		.where(and(
			eq(checklistItems.id, params.itemId),
			eq(checklistItems.userId, userId)
		))
		.returning();

	if (!deleted.length) return json({ error: 'Ikke funnet' }, { status: 404 });
	return json({ ok: true });
};
