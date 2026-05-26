import { z } from 'zod';
import { db } from '$lib/db';
import { meals, mealPlans } from '$lib/db/schema';
import { eq, and, ilike } from 'drizzle-orm';

async function findOrCreateMealId(userId: string, name: string): Promise<string | null> {
	const trimmed = name.trim();
	if (!trimmed) return null;
	const safe = trimmed.replace(/[\\%_]/g, (ch) => `\\${ch}`);

	const exact = await db
		.select({ id: meals.id })
		.from(meals)
		.where(and(eq(meals.userId, userId), ilike(meals.title, safe)))
		.limit(2);
	if (exact.length === 1) return exact[0].id;

	const [created] = await db
		.insert(meals)
		.values({ userId, title: trimmed })
		.returning({ id: meals.id });
	return created?.id ?? null;
}

export const manageMealPlanTool = {
	name: 'manage_meal_plan',
	description: `Add, update or remove a meal plan entry for a specific date and meal type.

Use this to build or edit the user's weekly menu. Either link to a saved meal via mealId,
or pass mealName to auto-create a lightweight meal row (name only — recipe details can
be filled in later via manage_recipe).`,

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
		const resolveMealId = async (): Promise<string | null | undefined> => {
			if (args.mealId !== undefined) return args.mealId;
			if (args.mealName) return findOrCreateMealId(args.userId, args.mealName);
			return undefined;
		};

		if (args.action === 'create') {
			if (!args.weekContext || !args.date || !args.mealType) {
				return { error: 'weekContext, date and mealType required for create' };
			}
			const mealId = (await resolveMealId()) ?? null;
			const [created] = await db
				.insert(mealPlans)
				.values({
					userId: args.userId,
					weekContext: args.weekContext,
					date: args.date,
					mealType: args.mealType,
					mealId,
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
			const resolved = await resolveMealId();
			if (resolved !== undefined) updates.mealId = resolved;
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
