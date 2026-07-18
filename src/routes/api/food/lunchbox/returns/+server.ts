import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { lunchboxReturns } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

// POST /api/food/lunchbox/returns — logg at noe kom i retur («8 skiver tilbake»)
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json();

	if (!body.personId || !body.date || !body.itemName) {
		return json({ error: 'personId, date and itemName required' }, { status: 400 });
	}

	const degree = ['alt', 'mesteparten', 'noe'].includes(body.degree) ? body.degree : 'noe';

	const [created] = await db
		.insert(lunchboxReturns)
		.values({
			userId,
			personId: body.personId,
			date: body.date,
			entryId: body.entryId ?? null,
			componentId: body.componentId ?? null,
			itemName: String(body.itemName).trim(),
			quantity: body.quantity != null ? Number(body.quantity) : null,
			degree,
			note: body.note ? String(body.note) : null
		})
		.returning();
	return json({ return: created }, { status: 201 });
};

// DELETE /api/food/lunchbox/returns?id= — angre en retur-logging
export const DELETE: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'id required' }, { status: 400 });

	const deleted = await db
		.delete(lunchboxReturns)
		.where(and(eq(lunchboxReturns.id, id), eq(lunchboxReturns.userId, userId)))
		.returning({ id: lunchboxReturns.id });
	if (deleted.length === 0) return json({ error: 'Not found' }, { status: 404 });
	return json({ deleted: true });
};
