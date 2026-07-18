import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { lunchboxEntries } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

// POST /api/food/lunchbox/entries — lagre dagens matpakke for et barn.
// Upsert på (bruker, barn, dato); packed=true stempler packedAt («Pakk denne»).
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json();

	if (!body.personId || !body.date) {
		return json({ error: 'personId and date required' }, { status: 400 });
	}
	const items = Array.isArray(body.items) ? body.items : [];
	const source = body.source === 'manual' ? 'manual' : 'suggested';
	const packedAt = body.packed ? new Date() : null;

	const existing = await db.query.lunchboxEntries.findFirst({
		where: and(
			eq(lunchboxEntries.userId, userId),
			eq(lunchboxEntries.personId, body.personId),
			eq(lunchboxEntries.date, body.date)
		)
	});

	if (existing) {
		const [updated] = await db
			.update(lunchboxEntries)
			.set({
				items,
				source,
				packedAt: packedAt ?? existing.packedAt
			})
			.where(eq(lunchboxEntries.id, existing.id))
			.returning();
		return json({ entry: updated });
	}

	const [created] = await db
		.insert(lunchboxEntries)
		.values({ userId, personId: body.personId, date: body.date, items, source, packedAt })
		.returning();
	return json({ entry: created }, { status: 201 });
};

// DELETE /api/food/lunchbox/entries?id= — angre «pakket» (fjern dagens entry)
export const DELETE: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'id required' }, { status: 400 });

	const deleted = await db
		.delete(lunchboxEntries)
		.where(and(eq(lunchboxEntries.id, id), eq(lunchboxEntries.userId, userId)))
		.returning({ id: lunchboxEntries.id });
	if (deleted.length === 0) return json({ error: 'Not found' }, { status: 404 });
	return json({ deleted: true });
};
