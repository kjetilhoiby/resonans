import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { recipes } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	const rows = await db
		.select()
		.from(recipes)
		.where(eq(recipes.userId, userId))
		.orderBy(desc(recipes.createdAt));
	return json({ recipes: rows });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json();

	if (!body.title) {
		return json({ error: 'title is required' }, { status: 400 });
	}

	const [created] = await db
		.insert(recipes)
		.values({
			userId,
			title: body.title,
			description: body.description ?? null,
			ingredients: Array.isArray(body.ingredients) ? body.ingredients : [],
			instructions: Array.isArray(body.instructions) ? body.instructions : [],
			prepTimeMin: body.prepTimeMin ?? null,
			cookTimeMin: body.cookTimeMin ?? null,
			servings: body.servings ?? 2,
			tags: Array.isArray(body.tags) ? body.tags : [],
			imageUrl: body.imageUrl ?? null,
			sourceUrl: body.sourceUrl ?? null,
			nutritionEstimate: body.nutritionEstimate ?? null
		})
		.returning();

	return json({ recipe: created }, { status: 201 });
};
