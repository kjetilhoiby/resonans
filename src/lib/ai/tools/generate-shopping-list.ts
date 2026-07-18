import { z } from 'zod';
import { buildWeekShoppingList } from '$lib/server/services/shopping-list-service';

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
		const { items, meta } = await buildWeekShoppingList(args.userId, args.weekContext, {
			includeOptional: args.includeOptional
		});

		return {
			weekContext: args.weekContext,
			items: items.map((item) => ({
				text:
					item.quantity != null && item.unit
						? `${item.name} (${item.quantity} ${item.unit})`
						: item.quantity != null
							? `${item.name} (${item.quantity})`
							: item.name,
				sources: item.sources
			})),
			pantrySkipped: meta.pantrySkipped,
			mealCount: meta.mealCount
		};
	}
};
