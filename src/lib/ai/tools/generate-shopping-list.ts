import { z } from 'zod';
import { db } from '$lib/db';
import { mealPlans, recipes, pantryItems } from '$lib/db/schema';
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

Reads meal plans for weekContext, expands linked recipes' ingredients, then removes ingredients
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

		const recipeIds = plans.map((p) => p.recipeId).filter((id): id is string => !!id);
		const linkedRecipes = recipeIds.length
			? await db.select().from(recipes).where(and(eq(recipes.userId, args.userId), inArray(recipes.id, recipeIds)))
			: [];
		const recipesById = new Map(linkedRecipes.map((r) => [r.id, r]));

		const pantry = await db.select().from(pantryItems).where(eq(pantryItems.userId, args.userId));
		const pantryNames = new Set(pantry.map((p) => normalizeName(p.name)));

		const aggregated = new Map<string, { name: string; quantity?: number; unit?: string | null; sources: string[] }>();

		for (const plan of plans) {
			if (!plan.recipeId) continue;
			const recipe = recipesById.get(plan.recipeId);
			if (!recipe) continue;
			const scale = recipe.servings > 0 ? plan.servings / recipe.servings : 1;

			for (const ing of recipe.ingredients as Ingredient[]) {
				if (ing.optional && !args.includeOptional) continue;
				const key = normalizeName(ing.name);
				if (pantryNames.has(key)) continue;

				const existing = aggregated.get(key);
				const scaledQty = ing.quantity != null ? ing.quantity * scale : undefined;
				if (existing) {
					if (scaledQty != null && existing.quantity != null && existing.unit === (ing.unit ?? null)) {
						existing.quantity += scaledQty;
					}
					existing.sources.push(recipe.title);
				} else {
					aggregated.set(key, {
						name: ing.name,
						quantity: scaledQty,
						unit: ing.unit ?? null,
						sources: [recipe.title]
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
			recipeCount: linkedRecipes.length
		};
	}
};
