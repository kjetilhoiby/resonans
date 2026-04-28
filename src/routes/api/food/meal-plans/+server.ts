import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { mealPlans } from '$lib/db/schema';
import { and, eq, asc } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const weekContext = url.searchParams.get('weekContext');

	const conditions = [eq(mealPlans.userId, userId)];
	if (weekContext) conditions.push(eq(mealPlans.weekContext, weekContext));

	const rows = await db
		.select()
		.from(mealPlans)
		.where(and(...conditions))
		.orderBy(asc(mealPlans.date), asc(mealPlans.mealType));

	return json({ mealPlans: rows });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json();

	if (!body.weekContext || !body.date || !body.mealType) {
		return json({ error: 'weekContext, date and mealType required' }, { status: 400 });
	}

	const [created] = await db
		.insert(mealPlans)
		.values({
			userId,
			weekContext: body.weekContext,
			date: body.date,
			mealType: body.mealType,
			recipeId: body.recipeId ?? null,
			customTitle: body.customTitle ?? null,
			notes: body.notes ?? null,
			servings: body.servings ?? 2,
			photoUrl: body.photoUrl ?? null
		})
		.returning();

	return json({ mealPlan: created }, { status: 201 });
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json();

	if (!body.id) return json({ error: 'id required' }, { status: 400 });

	const updates: Record<string, unknown> = {};
	for (const key of ['date', 'mealType', 'recipeId', 'customTitle', 'notes', 'servings', 'photoUrl']) {
		if (key in body) updates[key] = body[key];
	}

	const [updated] = await db
		.update(mealPlans)
		.set(updates)
		.where(and(eq(mealPlans.id, body.id), eq(mealPlans.userId, userId)))
		.returning();

	if (!updated) return json({ error: 'Not found' }, { status: 404 });
	return json({ mealPlan: updated });
};

export const DELETE: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'id required' }, { status: 400 });

	const deleted = await db
		.delete(mealPlans)
		.where(and(eq(mealPlans.id, id), eq(mealPlans.userId, userId)))
		.returning({ id: mealPlans.id });

	if (deleted.length === 0) return json({ error: 'Not found' }, { status: 404 });
	return json({ deleted: true });
};
