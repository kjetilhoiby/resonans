import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { mealPlans, meals, pantryItems } from '$lib/db/schema';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { addDaysIso, datesForIsoWeek, isoWeekKeyForDate, osloTodayIso } from '$lib/server/iso-week';
import { suggestWeekDinners, scoreMeal, type SuggestibleMeal } from '$lib/domains/food/meal-suggestions';
import { generateVariants } from '$lib/domains/food/composition';
import { getWeekShoppingList } from '$lib/server/services/shopping-list-service';
import { getWeekMealPlansWithTitles } from '$lib/server/services/meal-plan-sync';

// GET /api/food/week-session?weekContext=2026-W31 — datagrunnlag for onsdagsøkta.
// Default-uke er NESTE uke (økta kjøres typisk onsdag for uka etter).
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const today = osloTodayIso();
	const weekContext = url.searchParams.get('weekContext') ?? isoWeekKeyForDate(addDaysIso(today, 7));
	const days = datesForIsoWeek(weekContext);
	if (days.length === 0) return json({ error: 'Ugyldig weekContext' }, { status: 400 });

	// Kartoteket med bruksstatistikk (for forslags-scoring)
	const allMeals = await db.select().from(meals).where(eq(meals.userId, userId));
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

	const suggestible: SuggestibleMeal[] = allMeals.map((meal) => ({
		id: meal.id,
		title: meal.title,
		tags: meal.tags,
		prepTimeMin: meal.prepTimeMin,
		cookTimeMin: meal.cookTimeMin,
		ingredients: (meal.ingredients as Array<{ name: string }>) ?? [],
		lastPlannedDate: statsByMeal.get(meal.id)?.lastPlannedDate ?? null,
		timesPlanned: statsByMeal.get(meal.id)?.timesPlanned ?? 0,
		wantMore: meal.wantMore
	}));

	// Varer som går ut innen uka — booster retter som bruker dem
	const expiring = await db
		.select({ name: pantryItems.name })
		.from(pantryItems)
		.where(
			and(
				eq(pantryItems.userId, userId),
				gte(pantryItems.expiresAt, today),
				lte(pantryItems.expiresAt, days[6])
			)
		);

	const suggestions = suggestWeekDinners({
		days,
		meals: suggestible,
		expiringPantryNames: expiring.map((e) => e.name),
		seed: url.searchParams.get('seed') ?? weekContext
	});

	const existingPlans = await getWeekMealPlansWithTitles(userId, weekContext);
	const shoppingList = await getWeekShoppingList(userId, weekContext);

	// Flat kandidatbunke for «middagstinder»: hele kartoteket scoret og sortert,
	// pluss genererte varianter (rekombinert av kjente råvarer) til slutt.
	const referenceDate = days[0];
	const expiringNames = expiring.map((e) => e.name);
	const scoredPool = suggestible
		.map((meal) => ({ meal, ...scoreMeal(meal, { referenceDate, expiringPantryNames: expiringNames }) }))
		.sort((a, b) => b.score - a.score || a.meal.title.localeCompare(b.meal.title, 'nb'));

	const mealCandidates = scoredPool.map((s) => ({
		mealId: s.meal.id,
		title: s.meal.title,
		reason: s.reasons[0] ?? 'på rotasjon',
		isVariant: false as const
	}));

	const variantCandidates = generateVariants({
		meals: allMeals.map((m) => ({ mainProtein: m.mainProtein, mainCarb: m.mainCarb, greens: m.greens })),
		seed: weekContext,
		limit: 8
	}).map((v) => ({
		title: v.title,
		reason: v.reason,
		isVariant: true as const,
		composition: { mainProtein: v.mainProtein, mainCarb: v.mainCarb, greens: v.greens }
	}));

	return json({
		weekContext,
		days: days.map((date, index) => ({
			date,
			existingPlans: existingPlans.filter((plan) => plan.date === date && plan.mealType === 'dinner'),
			suggestion: suggestions[index]?.suggestion ?? null,
			alternatives: suggestions[index]?.alternatives ?? []
		})),
		candidates: [...mealCandidates, ...variantCandidates],
		recipeCount: allMeals.length,
		shoppingList: shoppingList
			? { id: shoppingList.id, status: shoppingList.status, itemCount: shoppingList.items.length }
			: null
	});
};
