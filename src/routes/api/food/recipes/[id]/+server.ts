import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { recipes } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params, locals }) => {
	const userId = locals.userId;
	const [row] = await db
		.select()
		.from(recipes)
		.where(and(eq(recipes.id, params.id), eq(recipes.userId, userId)));
	if (!row) return json({ error: 'Not found' }, { status: 404 });
	return json({ recipe: row });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const userId = locals.userId;
	const body = await request.json();

	const updates: Record<string, unknown> = { updatedAt: new Date() };
	for (const key of [
		'title',
		'description',
		'ingredients',
		'instructions',
		'prepTimeMin',
		'cookTimeMin',
		'servings',
		'tags',
		'imageUrl',
		'sourceUrl',
		'nutritionEstimate'
	]) {
		if (key in body) updates[key] = body[key];
	}

	const [updated] = await db
		.update(recipes)
		.set(updates)
		.where(and(eq(recipes.id, params.id), eq(recipes.userId, userId)))
		.returning();

	if (!updated) return json({ error: 'Not found' }, { status: 404 });
	return json({ recipe: updated });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const userId = locals.userId;
	const deleted = await db
		.delete(recipes)
		.where(and(eq(recipes.id, params.id), eq(recipes.userId, userId)))
		.returning({ id: recipes.id });
	if (deleted.length === 0) return json({ error: 'Not found' }, { status: 404 });
	return json({ deleted: true });
};
