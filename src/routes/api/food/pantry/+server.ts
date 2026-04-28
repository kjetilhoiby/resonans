import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { pantryItems } from '$lib/db/schema';
import { and, eq, asc } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const location = url.searchParams.get('location');

	const conditions = [eq(pantryItems.userId, userId)];
	if (location) conditions.push(eq(pantryItems.location, location));

	const rows = await db
		.select()
		.from(pantryItems)
		.where(and(...conditions))
		.orderBy(asc(pantryItems.location), asc(pantryItems.name));

	return json({ pantry: rows });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json();

	if (!body.name || !body.location) {
		return json({ error: 'name and location required' }, { status: 400 });
	}

	const [created] = await db
		.insert(pantryItems)
		.values({
			userId,
			name: body.name,
			location: body.location,
			quantity: body.quantity != null ? String(body.quantity) : null,
			unit: body.unit ?? null,
			expiresAt: body.expiresAt ?? null,
			notes: body.notes ?? null
		})
		.returning();

	return json({ pantryItem: created }, { status: 201 });
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json();

	if (!body.id) return json({ error: 'id required' }, { status: 400 });

	const updates: Record<string, unknown> = {};
	if ('name' in body) updates.name = body.name;
	if ('location' in body) updates.location = body.location;
	if ('quantity' in body) updates.quantity = body.quantity != null ? String(body.quantity) : null;
	if ('unit' in body) updates.unit = body.unit;
	if ('expiresAt' in body) updates.expiresAt = body.expiresAt;
	if ('notes' in body) updates.notes = body.notes;
	if ('lastUsedAt' in body) updates.lastUsedAt = body.lastUsedAt ? new Date(body.lastUsedAt) : null;

	const [updated] = await db
		.update(pantryItems)
		.set(updates)
		.where(and(eq(pantryItems.id, body.id), eq(pantryItems.userId, userId)))
		.returning();

	if (!updated) return json({ error: 'Not found' }, { status: 404 });
	return json({ pantryItem: updated });
};

export const DELETE: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'id required' }, { status: 400 });

	const deleted = await db
		.delete(pantryItems)
		.where(and(eq(pantryItems.id, id), eq(pantryItems.userId, userId)))
		.returning({ id: pantryItems.id });

	if (deleted.length === 0) return json({ error: 'Not found' }, { status: 404 });
	return json({ deleted: true });
};
