import { z } from 'zod';
import {
	upsertMealPlan,
	deleteMealPlan
} from '$lib/server/services/meal-plan-sync';

export const manageMealPlanTool = {
	name: 'manage_meal_plan',
	description: `Add, update or remove a meal plan entry for a specific date and meal type.

Use this to build or edit the user's weekly menu. Either link to a saved meal via mealId,
or pass mealName to auto-create a lightweight meal row (name only — recipe details can
be filled in later via manage_recipe). Changes are mirrored automatically to the day's
checklist in ukeplan as a "middag: …" item (and vice versa).`,

	parameters: z.object({
		userId: z.string(),
		action: z.enum(['create', 'update', 'delete']),
		id: z.string().uuid().optional(),
		weekContext: z.string().optional().describe('ISO week, e.g. "2026-W17"'),
		date: z.string().optional().describe('YYYY-MM-DD'),
		mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
		mealId: z.string().uuid().nullable().optional().describe('Link to an existing meal row'),
		mealName: z.string().optional().describe('Name of meal; auto-creates a meal row if no mealId is given'),
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
		mealId?: string | null;
		mealName?: string;
		notes?: string;
		servings?: number;
		photoUrl?: string;
	}) => {
		if (args.action === 'create') {
			if (!args.weekContext || !args.date || !args.mealType) {
				return { error: 'weekContext, date and mealType required for create' };
			}
			const created = await upsertMealPlan(args.userId, {
				weekContext: args.weekContext,
				date: args.date,
				mealType: args.mealType,
				mealId: args.mealId,
				mealName: args.mealName,
				notes: args.notes,
				servings: args.servings,
				photoUrl: args.photoUrl
			});
			return created ? { mealPlan: created } : { error: 'could not create meal plan' };
		}

		if (args.action === 'update') {
			if (!args.id) return { error: 'id required for update' };
			const updated = await upsertMealPlan(args.userId, {
				id: args.id,
				weekContext: args.weekContext,
				date: args.date,
				mealType: args.mealType,
				mealId: args.mealId,
				mealName: args.mealName,
				notes: args.notes,
				servings: args.servings,
				photoUrl: args.photoUrl
			});
			return updated ? { mealPlan: updated } : { error: 'meal plan not found' };
		}

		if (args.action === 'delete') {
			if (!args.id) return { error: 'id required for delete' };
			const deleted = await deleteMealPlan(args.userId, args.id);
			return { deleted };
		}
	}
};
