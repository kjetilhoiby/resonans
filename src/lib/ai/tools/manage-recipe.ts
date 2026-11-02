import { z } from 'zod';
import { db } from '$lib/db';
import { meals } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { normalizeComponent } from '$lib/domains/food/composition';
import { TAKEAWAY_TAG, withTag } from '$lib/domains/food/meal-log';

/** favorite/takeaway er tagger; flagget legges oppå tags-lista (eksplisitt eller lagret). */
function applyFlagTags(
	tags: string[],
	flags: { favorite?: boolean; takeaway?: boolean }
): string[] {
	let next = tags;
	if (flags.favorite !== undefined) next = withTag(next, 'favoritt', flags.favorite);
	if (flags.takeaway !== undefined) next = withTag(next, TAKEAWAY_TAG, flags.takeaway);
	return next;
}

const ingredientSchema = z.object({
	name: z.string(),
	quantity: z.number().nullable().optional(),
	unit: z.string().nullable().optional(),
	optional: z.boolean().optional()
});

export const manageRecipeTool = {
	name: 'manage_recipe',
	description: `Create, update or delete a meal/recipe owned by the user.

A meal is the building block in the food universe — primarily a name (e.g. "kjøttkaker"),
with optional recipe details (ingredients, instructions, images, nutrition). Use this when
the user wants to attach an oppskrift to a meal, edit an existing one, or remove it.
For 'create' you must supply title; ingredients are optional. For 'update'/'delete' supply id.

Komponerte middager kan struktureres med mainProtein (kjøtt/kylling/svin/fisk/torsk/vegetar/egg),
mainCarb (pasta/potet/ris/brød/couscous/nudler) og greens — dette gjør at systemet kan generere
varianter ved å bytte råvarer. La feltene stå tomme for retter som ikke passer (suppe, taco, pizza).
effortLevel er lav/middels/høy.

To ulike ting, ikke bland dem:
- favorite=true: en BEVIST familiefavoritt («alle elsker ramen»). Settes som taggen «favoritt»; andre tagger røres ikke.
- wantMore=true: en AMBISJON — noe familien vil spise oftere, men ikke nødvendigvis gjør.
Begge løfter retten i forslagene. Takeaway/restaurant settes med takeaway=true; slike retter foreslås aldri å lage.

Ukjente mengder: utelat quantity/unit framfor å gjette — et tomt felt er ærlig, et gjettet tall havner på handlelista.
For å registrere at retten ble SPIST (eller planlegge den), bruk manage_meal_plan — ikke denne.`,

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
		mainProtein: z.string().nullable().optional(),
		mainCarb: z.string().nullable().optional(),
		greens: z.string().nullable().optional(),
		favorite: z.boolean().optional().describe('Familiefavoritt (taggen «favoritt»)'),
		takeaway: z.boolean().optional().describe('Takeaway/restaurant — foreslås aldri å lage'),
		wantMore: z.boolean().optional().describe('Ønsker mer av — en ambisjon, ikke en favoritt'),
		effortLevel: z.enum(['lav', 'middels', 'høy']).nullable().optional(),
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
		mainProtein?: string | null;
		mainCarb?: string | null;
		greens?: string | null;
		favorite?: boolean;
		takeaway?: boolean;
		wantMore?: boolean;
		effortLevel?: 'lav' | 'middels' | 'høy' | null;
		imageUrl?: string;
		sourceUrl?: string;
	}) => {
		if (args.action === 'create') {
			if (!args.title) {
				return { error: 'title required for create' };
			}
			const [created] = await db
				.insert(meals)
				.values({
					userId: args.userId,
					title: args.title,
					description: args.description,
					ingredients: args.ingredients ?? [],
					instructions: args.instructions ?? [],
					prepTimeMin: args.prepTimeMin,
					cookTimeMin: args.cookTimeMin,
					servings: args.servings ?? 2,
					tags: applyFlagTags(args.tags ?? [], args),
					mainProtein: args.mainProtein !== undefined ? normalizeComponent('protein', args.mainProtein) : null,
					mainCarb: args.mainCarb !== undefined ? normalizeComponent('carb', args.mainCarb) : null,
					greens: args.greens !== undefined ? normalizeComponent('greens', args.greens) : null,
					wantMore: args.wantMore ?? false,
					effortLevel: args.effortLevel ?? null,
					imageUrl: args.imageUrl,
					sourceUrl: args.sourceUrl
				})
				.returning();
			return { meal: created };
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
			if (args.tags !== undefined || args.favorite !== undefined || args.takeaway !== undefined) {
				let baseTags = args.tags;
				if (baseTags === undefined) {
					const current = await db.query.meals.findFirst({
						where: and(eq(meals.id, args.id), eq(meals.userId, args.userId)),
						columns: { tags: true }
					});
					if (!current) return { error: 'meal not found' };
					baseTags = current.tags;
				}
				updates.tags = applyFlagTags(baseTags, args);
			}
			if (args.mainProtein !== undefined) updates.mainProtein = normalizeComponent('protein', args.mainProtein);
			if (args.mainCarb !== undefined) updates.mainCarb = normalizeComponent('carb', args.mainCarb);
			if (args.greens !== undefined) updates.greens = normalizeComponent('greens', args.greens);
			if (args.wantMore !== undefined) updates.wantMore = args.wantMore;
			if (args.effortLevel !== undefined) updates.effortLevel = args.effortLevel;
			if (args.imageUrl !== undefined) updates.imageUrl = args.imageUrl;
			if (args.sourceUrl !== undefined) updates.sourceUrl = args.sourceUrl;

			const [updated] = await db
				.update(meals)
				.set(updates)
				.where(and(eq(meals.id, args.id), eq(meals.userId, args.userId)))
				.returning();
			return updated ? { meal: updated } : { error: 'meal not found' };
		}

		if (args.action === 'delete') {
			if (!args.id) return { error: 'id required for delete' };
			const deleted = await db
				.delete(meals)
				.where(and(eq(meals.id, args.id), eq(meals.userId, args.userId)))
				.returning({ id: meals.id });
			return { deleted: deleted.length > 0 };
		}
	}
};
