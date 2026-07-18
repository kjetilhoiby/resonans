import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { meals, mealPlans } from '$lib/db/schema';
import { eq, desc, and, ilike, sql } from 'drizzle-orm';
import { escapeLike } from '$lib/utils/like-escape';

// GET /api/food/recipes?q=&tag=&withStats=1 — oppskriftskartoteket.
// withStats beriker hver oppskrift med timesPlanned + lastPlannedDate fra meal_plans.
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const q = url.searchParams.get('q')?.trim();
	const tag = url.searchParams.get('tag')?.trim();
	const withStats = url.searchParams.get('withStats') === '1';

	const conditions = [eq(meals.userId, userId)];
	if (q) {
		conditions.push(ilike(meals.title, `%${escapeLike(q)}%`));
	}
	if (tag) {
		conditions.push(sql`${tag} = ANY(${meals.tags})`);
	}

	const rows = await db
		.select()
		.from(meals)
		.where(and(...conditions))
		.orderBy(desc(meals.createdAt));

	if (!withStats || rows.length === 0) {
		return json({ meals: rows });
	}

	const stats = await db
		.select({
			mealId: mealPlans.mealId,
			timesPlanned: sql<number>`count(*)::int`,
			lastPlannedDate: sql<string | null>`max(${mealPlans.date})`
		})
		.from(mealPlans)
		.where(eq(mealPlans.userId, userId))
		.groupBy(mealPlans.mealId);

	const statsByMeal = new Map(stats.map((s) => [s.mealId, s]));
	const enriched = rows.map((meal) => {
		const stat = statsByMeal.get(meal.id);
		return {
			...meal,
			timesPlanned: stat?.timesPlanned ?? 0,
			lastPlannedDate: stat?.lastPlannedDate ?? null
		};
	});

	return json({ meals: enriched });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json();

	if (!body.title) {
		return json({ error: 'title is required' }, { status: 400 });
	}

	const [created] = await db
		.insert(meals)
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

	return json({ meal: created }, { status: 201 });
};
