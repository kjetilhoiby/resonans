import { z } from 'zod';
import { db } from '$lib/db';
import { recipes, mealPlans, pantryItems } from '$lib/db/schema';
import { eq, and, gte, lte, desc, asc } from 'drizzle-orm';

export const queryFoodTool = {
	name: 'query_food',
	description: `Read user's food data: recipes, weekly meal plans, and pantry/freezer contents.

Query types:
- 'recipes': List the user's saved recipes (limit 50)
- 'meal_plan': Get all meal plan entries for a given week (requires weekContext like "2026-W17")
- 'pantry': List pantry items, optionally filtered by location (pantry/fridge/freezer)
- 'expiring_soon': List pantry items expiring within N days (default 7)`,

	parameters: z.object({
		userId: z.string().describe('User ID'),
		queryType: z.enum(['recipes', 'meal_plan', 'pantry', 'expiring_soon']),
		weekContext: z.string().optional().describe('ISO week, e.g. "2026-W17". Required for meal_plan.'),
		location: z.enum(['pantry', 'fridge', 'freezer']).optional().describe('Filter pantry by location'),
		days: z.number().optional().describe('Days ahead for expiring_soon (default 7)'),
		limit: z.number().optional()
	}),

	execute: async (args: {
		userId: string;
		queryType: 'recipes' | 'meal_plan' | 'pantry' | 'expiring_soon';
		weekContext?: string;
		location?: 'pantry' | 'fridge' | 'freezer';
		days?: number;
		limit?: number;
	}) => {
		switch (args.queryType) {
			case 'recipes': {
				const rows = await db
					.select()
					.from(recipes)
					.where(eq(recipes.userId, args.userId))
					.orderBy(desc(recipes.createdAt))
					.limit(args.limit ?? 50);
				return { recipes: rows };
			}

			case 'meal_plan': {
				if (!args.weekContext) {
					return { error: 'weekContext is required for meal_plan' };
				}
				const rows = await db
					.select()
					.from(mealPlans)
					.where(and(eq(mealPlans.userId, args.userId), eq(mealPlans.weekContext, args.weekContext)))
					.orderBy(asc(mealPlans.date), asc(mealPlans.mealType));
				return { weekContext: args.weekContext, mealPlans: rows };
			}

			case 'pantry': {
				const conditions = [eq(pantryItems.userId, args.userId)];
				if (args.location) conditions.push(eq(pantryItems.location, args.location));
				const rows = await db
					.select()
					.from(pantryItems)
					.where(and(...conditions))
					.orderBy(asc(pantryItems.location), asc(pantryItems.name));
				return { pantry: rows };
			}

			case 'expiring_soon': {
				const days = args.days ?? 7;
				const today = new Date();
				const horizon = new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
				const todayStr = today.toISOString().slice(0, 10);
				const horizonStr = horizon.toISOString().slice(0, 10);
				const rows = await db
					.select()
					.from(pantryItems)
					.where(
						and(
							eq(pantryItems.userId, args.userId),
							gte(pantryItems.expiresAt, todayStr),
							lte(pantryItems.expiresAt, horizonStr)
						)
					)
					.orderBy(asc(pantryItems.expiresAt));
				return { expiringSoon: rows, withinDays: days };
			}
		}
	}
};
