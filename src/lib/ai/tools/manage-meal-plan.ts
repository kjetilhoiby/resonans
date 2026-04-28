import { z } from 'zod';
import { db } from '$lib/db';
import { mealPlans } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const manageMealPlanTool = {
	name: 'manage_meal_plan',
	description: `Add, update or remove a meal plan entry for a specific date and meal type.

Use this to build or edit the user's weekly menu. Either link to a saved recipe via recipeId,
or set customTitle for free-text entries (e.g. "frossenpizza", "rester fra i går").`,

	parameters: z.object({
		userId: z.string(),
		action: z.enum(['create', 'update', 'delete']),
		id: z.string().uuid().optional(),
		weekContext: z.string().optional().describe('ISO week, e.g. "2026-W17"'),
		date: z.string().optional().describe('YYYY-MM-DD'),
		mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
		recipeId: z.string().uuid().nullable().optional(),
		customTitle: z.string().optional(),
		notes: z.string().optional(),
		servings: z.number().optional(),
		photoUrl: z.string().optional()
	}),

	execute: async (args: {
		userId: string;
		action: 'create' | 'update' | 'delete';
		id?: string;
		weekContext?: string;
		date?: string;
		mealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
		recipeId?: string | null;
		customTitle?: string;
		notes?: string;
		servings?: number;
		photoUrl?: string;
	}) => {
		if (args.action === 'create') {
			if (!args.weekContext || !args.date || !args.mealType) {
				return { error: 'weekContext, date and mealType required for create' };
			}
			const [created] = await db
				.insert(mealPlans)
				.values({
					userId: args.userId,
					weekContext: args.weekContext,
					date: args.date,
					mealType: args.mealType,
					recipeId: args.recipeId ?? null,
					customTitle: args.customTitle,
					notes: args.notes,
					servings: args.servings ?? 2,
					photoUrl: args.photoUrl
				})
				.returning();
			return { mealPlan: created };
		}

		if (args.action === 'update') {
			if (!args.id) return { error: 'id required for update' };
			const updates: Record<string, unknown> = {};
			if (args.date !== undefined) updates.date = args.date;
			if (args.mealType !== undefined) updates.mealType = args.mealType;
			if (args.recipeId !== undefined) updates.recipeId = args.recipeId;
			if (args.customTitle !== undefined) updates.customTitle = args.customTitle;
			if (args.notes !== undefined) updates.notes = args.notes;
			if (args.servings !== undefined) updates.servings = args.servings;
			if (args.photoUrl !== undefined) updates.photoUrl = args.photoUrl;

			const [updated] = await db
				.update(mealPlans)
				.set(updates)
				.where(and(eq(mealPlans.id, args.id), eq(mealPlans.userId, args.userId)))
				.returning();
			return updated ? { mealPlan: updated } : { error: 'meal plan not found' };
		}

		if (args.action === 'delete') {
			if (!args.id) return { error: 'id required for delete' };
			const deleted = await db
				.delete(mealPlans)
				.where(and(eq(mealPlans.id, args.id), eq(mealPlans.userId, args.userId)))
				.returning({ id: mealPlans.id });
			return { deleted: deleted.length > 0 };
		}
	}
};
