import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes, mealPlans, recipes, pantryItems } from '$lib/db/schema';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import { and, eq, gte, lte, asc, inArray } from 'drizzle-orm';

function getIsoWeekContext(now = new Date()): string {
	const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	const day = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - day);
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export const GET: RequestHandler = async ({ params, locals, url }) => {
	const userId = locals.userId;

	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, userId))
	});

	if (!theme) {
		return json({ error: 'Tema ikke funnet.' }, { status: 404 });
	}

	if (resolveThemeDashboardKind(theme.name) !== 'food') {
		return json({ error: 'Temaet har ikke matdashboard.' }, { status: 400 });
	}

	const weekContext = url.searchParams.get('weekContext') ?? getIsoWeekContext();

	const plans = await db
		.select()
		.from(mealPlans)
		.where(and(eq(mealPlans.userId, userId), eq(mealPlans.weekContext, weekContext)))
		.orderBy(asc(mealPlans.date), asc(mealPlans.mealType));

	const recipeIds = plans.map((p) => p.recipeId).filter((id): id is string => !!id);
	const linkedRecipes = recipeIds.length
		? await db.select().from(recipes).where(and(eq(recipes.userId, userId), inArray(recipes.id, recipeIds)))
		: [];
	const recipesById = new Map(linkedRecipes.map((r) => [r.id, r]));

	const enrichedPlans = plans.map((p) => ({
		...p,
		recipeTitle: p.recipeId ? recipesById.get(p.recipeId)?.title ?? null : null
	}));

	const pantry = await db
		.select()
		.from(pantryItems)
		.where(eq(pantryItems.userId, userId))
		.orderBy(asc(pantryItems.location), asc(pantryItems.name));

	const today = new Date().toISOString().slice(0, 10);
	const horizon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
	const expiringSoon = await db
		.select()
		.from(pantryItems)
		.where(
			and(
				eq(pantryItems.userId, userId),
				gte(pantryItems.expiresAt, today),
				lte(pantryItems.expiresAt, horizon)
			)
		)
		.orderBy(asc(pantryItems.expiresAt));

	return json({
		weekContext,
		mealPlans: enrichedPlans,
		pantry,
		expiringSoon
	});
};
