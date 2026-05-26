import { z } from 'zod';
import { db } from '$lib/db';
import { mealPlans, meals, pantryItems } from '$lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';

type Ingredient = {
	name: string;
	quantity?: number | null;
	unit?: string | null;
	optional?: boolean;
};

function normalizeName(name: string): string {
	return name.toLowerCase().trim();
}

export const generateShoppingListTool = {
	name: 'generate_shopping_list',
	description: `Build a shopping list for a given week's meal plan, subtracting items already in pantry/fridge/freezer.

Reads meal plans for weekContext, expands linked meals' ingredients, then removes ingredients
that match a pantry item by name (case-insensitive). Returns a deduplicated list ready to be
turned into checklist items.`,

	parameters: z.object({
		userId: z.string(),
		weekContext: z.string().describe('ISO week, e.g. "2026-W17"'),
		includeOptional: z.boolean().optional().describe('Include optional ingredients (default false)')
	}),

	execute: async (args: { userId: string; weekContext: string; includeOptional?: boolean }) => {
		const plans = await db
			.select()
			.from(mealPlans)
			.where(and(eq(mealPlans.userId, args.userId), eq(mealPlans.weekContext, args.weekContext)));

		const mealIds = plans.map((p) => p.mealId).filter((id): id is string => !!id);
		const linkedMeals = mealIds.length
			? await db.select().from(meals).where(and(eq(meals.userId, args.userId), inArray(meals.id, mealIds)))
			: [];
		const mealsById = new Map(linkedMeals.map((m) => [m.id, m]));

		const pantry = await db.select().from(pantryItems).where(eq(pantryItems.userId, args.userId));
		const pantryNames = new Set(pantry.map((p) => normalizeName(p.name)));

		const aggregated = new Map<string, { name: string; quantity?: number; unit?: string | null; sources: string[] }>();

		for (const plan of plans) {
			if (!plan.mealId) continue;
			const meal = mealsById.get(plan.mealId);
			if (!meal) continue;
			const scale = meal.servings > 0 ? plan.servings / meal.servings : 1;

			for (const ing of meal.ingredients as Ingredient[]) {
				if (ing.optional && !args.includeOptional) continue;
				const key = normalizeName(ing.name);
				if (pantryNames.has(key)) continue;

				const existing = aggregated.get(key);
				const scaledQty = ing.quantity != null ? ing.quantity * scale : undefined;
				if (existing) {
					if (scaledQty != null && existing.quantity != null && existing.unit === (ing.unit ?? null)) {
						existing.quantity += scaledQty;
					}
					existing.sources.push(meal.title);
				} else {
					aggregated.set(key, {
						name: ing.name,
						quantity: scaledQty,
						unit: ing.unit ?? null,
						sources: [meal.title]
					});
				}
			}
		}

		const items = Array.from(aggregated.values()).map((entry) => ({
			text: entry.quantity != null && entry.unit
				? `${entry.name} (${entry.quantity} ${entry.unit})`
				: entry.quantity != null
					? `${entry.name} (${entry.quantity})`
					: entry.name,
			sources: entry.sources
		}));

		return {
			weekContext: args.weekContext,
			items,
			pantrySkipped: Array.from(pantryNames).length,
			mealCount: linkedMeals.length
		};
	}
};
