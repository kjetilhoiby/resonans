import { z } from 'zod';
import { db } from '$lib/db';
import { recipes } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

const ingredientSchema = z.object({
	name: z.string(),
	quantity: z.number().nullable().optional(),
	unit: z.string().nullable().optional(),
	optional: z.boolean().optional()
});

export const manageRecipeTool = {
	name: 'manage_recipe',
	description: `Create, update or delete a recipe owned by the user.

Use this when the user wants to save an oppskrift, edit an existing one, or remove it.
For 'create' you must supply title and ingredients. For 'update' or 'delete' you must supply id.`,

	parameters: z.object({
		userId: z.string(),
		action: z.enum(['create', 'update', 'delete']),
		id: z.string().uuid().optional(),
		title: z.string().optional(),
		description: z.string().optional(),
		ingredients: z.array(ingredientSchema).optional(),
		instructions: z.array(z.string()).optional(),
		prepTimeMin: z.number().optional(),
		cookTimeMin: z.number().optional(),
		servings: z.number().optional(),
		tags: z.array(z.string()).optional(),
		imageUrl: z.string().optional(),
		sourceUrl: z.string().optional()
	}),

	execute: async (args: {
		userId: string;
		action: 'create' | 'update' | 'delete';
		id?: string;
		title?: string;
		description?: string;
		ingredients?: Array<{ name: string; quantity?: number | null; unit?: string | null; optional?: boolean }>;
		instructions?: string[];
		prepTimeMin?: number;
		cookTimeMin?: number;
		servings?: number;
		tags?: string[];
		imageUrl?: string;
		sourceUrl?: string;
	}) => {
		if (args.action === 'create') {
			if (!args.title || !args.ingredients) {
				return { error: 'title and ingredients required for create' };
			}
			const [created] = await db
				.insert(recipes)
				.values({
					userId: args.userId,
					title: args.title,
					description: args.description,
					ingredients: args.ingredients,
					instructions: args.instructions ?? [],
					prepTimeMin: args.prepTimeMin,
					cookTimeMin: args.cookTimeMin,
					servings: args.servings ?? 2,
					tags: args.tags ?? [],
					imageUrl: args.imageUrl,
					sourceUrl: args.sourceUrl
				})
				.returning();
			return { recipe: created };
		}

		if (args.action === 'update') {
			if (!args.id) return { error: 'id required for update' };
			const updates: Record<string, unknown> = { updatedAt: new Date() };
			if (args.title !== undefined) updates.title = args.title;
			if (args.description !== undefined) updates.description = args.description;
			if (args.ingredients !== undefined) updates.ingredients = args.ingredients;
			if (args.instructions !== undefined) updates.instructions = args.instructions;
			if (args.prepTimeMin !== undefined) updates.prepTimeMin = args.prepTimeMin;
			if (args.cookTimeMin !== undefined) updates.cookTimeMin = args.cookTimeMin;
			if (args.servings !== undefined) updates.servings = args.servings;
			if (args.tags !== undefined) updates.tags = args.tags;
			if (args.imageUrl !== undefined) updates.imageUrl = args.imageUrl;
			if (args.sourceUrl !== undefined) updates.sourceUrl = args.sourceUrl;

			const [updated] = await db
				.update(recipes)
				.set(updates)
				.where(and(eq(recipes.id, args.id), eq(recipes.userId, args.userId)))
				.returning();
			return updated ? { recipe: updated } : { error: 'recipe not found' };
		}

		if (args.action === 'delete') {
			if (!args.id) return { error: 'id required for delete' };
			const deleted = await db
				.delete(recipes)
				.where(and(eq(recipes.id, args.id), eq(recipes.userId, args.userId)))
				.returning({ id: recipes.id });
			return { deleted: deleted.length > 0 };
		}
	}
};
