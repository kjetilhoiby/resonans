/**
 * Middagskortet og kartotekets hygiene: kortet samler retten, mengder for
 * familien og historikken; sammenslåingen fjerner en duplikat uten å miste
 * historikken. Reglene bor i $lib/domains/food/meal-card.ts.
 * Se docs/changelog/2026-11-24-middagsplanen-som-fasit.md.
 */

import { db } from '$lib/db';
import { checklistItems, finds, mealPlans, meals, tasks } from '$lib/db/schema';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { FAMILY_DEFAULT_SERVINGS } from '$lib/domains/food';
import {
	buildMealCardHistory,
	familyIngredients,
	mergeMealFields,
	normalizeMealTitle,
	type CardIngredient,
	type MergeableMeal
} from '$lib/domains/food/meal-card';
import { isMealPlanStatus, isFavoriteMeal, isTakeawayMeal, type MealPlanStatus } from '$lib/domains/food/meal-log';
import { osloTodayIso } from '$lib/server/iso-week';

type MealRow = typeof meals.$inferSelect;

/** En eksisterende rett med samme normaliserte tittel, eller null. */
export async function findMealByNormalizedTitle(
	userId: string,
	title: string,
	opts: { excludeId?: string } = {}
): Promise<MealRow | null> {
	const key = normalizeMealTitle(title);
	if (!key) return null;
	const rows = await db
		.select()
		.from(meals)
		.where(and(eq(meals.userId, userId), opts.excludeId ? ne(meals.id, opts.excludeId) : undefined))
		.orderBy(meals.createdAt);
	return rows.find((m) => normalizeMealTitle(m.title) === key) ?? null;
}

/** Middagskortet: retten, familiemengder, historikk og eventuelle duplikater. */
export async function getMealCard(userId: string, mealId: string) {
	const meal = await db.query.meals.findFirst({ where: and(eq(meals.id, mealId), eq(meals.userId, userId)) });
	if (!meal) return null;

	const [plans, duplicates] = await Promise.all([
		db
			.select({
				id: mealPlans.id,
				date: mealPlans.date,
				status: mealPlans.status,
				notes: mealPlans.notes,
				servings: mealPlans.servings
			})
			.from(mealPlans)
			.where(and(eq(mealPlans.userId, userId), eq(mealPlans.mealId, mealId)))
			.orderBy(desc(mealPlans.date)),
		db
			.select({ id: meals.id, title: meals.title })
			.from(meals)
			.where(and(eq(meals.userId, userId), ne(meals.id, mealId)))
	]);

	const key = normalizeMealTitle(meal.title);
	const history = buildMealCardHistory(
		plans.map((p) => ({ ...p, status: (isMealPlanStatus(p.status) ? p.status : 'planned') as MealPlanStatus })),
		osloTodayIso()
	);

	return {
		meal,
		favorite: isFavoriteMeal(meal.tags),
		takeaway: isTakeawayMeal(meal.tags),
		familyServings: FAMILY_DEFAULT_SERVINGS,
		familyIngredients: familyIngredients(meal.ingredients as CardIngredient[], meal.servings, FAMILY_DEFAULT_SERVINGS),
		history,
		duplicates: duplicates.filter((d) => normalizeMealTitle(d.title) === key)
	};
}

function toMergeable(meal: MealRow): MergeableMeal {
	return {
		title: meal.title,
		description: meal.description,
		ingredients: meal.ingredients as CardIngredient[],
		instructions: meal.instructions,
		prepTimeMin: meal.prepTimeMin,
		cookTimeMin: meal.cookTimeMin,
		servings: meal.servings,
		tags: meal.tags,
		mainProtein: meal.mainProtein,
		mainCarb: meal.mainCarb,
		greens: meal.greens,
		wantMore: meal.wantMore,
		effortLevel: meal.effortLevel,
		imageUrl: meal.imageUrl,
		sourceUrl: meal.sourceUrl,
		nutritionEstimate: meal.nutritionEstimate
	};
}

/**
 * Slå sammen to retter: alt som pekte på `dropId` (planrader, ukeliste-punkter,
 * vaner, funn) peker etterpå på `keepId`, feltene flettes etter
 * `mergeMealFields`, og duplikaten slettes. Historikken bevares fordi den bor på
 * planradene, som flyttes — ikke kopieres.
 */
export async function mergeMeals(
	userId: string,
	keepId: string,
	dropId: string
): Promise<{ meal: MealRow; movedPlans: number } | { error: string }> {
	if (keepId === dropId) return { error: 'En rett kan ikke slås sammen med seg selv' };

	return db.transaction(async (tx) => {
		const [keep] = await tx.select().from(meals).where(and(eq(meals.id, keepId), eq(meals.userId, userId)));
		const [drop] = await tx.select().from(meals).where(and(eq(meals.id, dropId), eq(meals.userId, userId)));
		if (!keep || !drop) return { error: 'Fant ikke begge rettene' };

		const moved = await tx
			.update(mealPlans)
			.set({ mealId: keepId, updatedAt: new Date() })
			.where(and(eq(mealPlans.userId, userId), eq(mealPlans.mealId, dropId)))
			.returning({ id: mealPlans.id });

		await tx
			.update(checklistItems)
			.set({ metadata: sql`jsonb_set(${checklistItems.metadata}, '{linkedMealId}', to_jsonb(${keepId}::text))` })
			.where(and(eq(checklistItems.userId, userId), sql`${checklistItems.metadata}->>'linkedMealId' = ${dropId}`));

		await tx
			.update(tasks)
			.set({
				metadata: sql`jsonb_set(${tasks.metadata}, '{parsedIntent,linkedMealId}', to_jsonb(${keepId}::text))`
			})
			// tasks har ingen userId-kolonne; dropId er alt verifisert som brukerens egen rett.
			.where(sql`${tasks.metadata}->'parsedIntent'->>'linkedMealId' = ${dropId}`);

		await tx
			.update(finds)
			.set({ mealId: keepId })
			.where(and(eq(finds.userId, userId), eq(finds.mealId, dropId)));

		const [updated] = await tx
			.update(meals)
			.set({ ...mergeMealFields(toMergeable(keep), toMergeable(drop)), updatedAt: new Date() } as Partial<MealRow>)
			.where(eq(meals.id, keepId))
			.returning();

		await tx.delete(meals).where(and(eq(meals.id, dropId), eq(meals.userId, userId)));

		return { meal: updated, movedPlans: moved.length };
	});
}
