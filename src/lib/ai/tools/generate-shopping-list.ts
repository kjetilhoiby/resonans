import { z } from 'zod';
import { buildWeekShoppingList } from '$lib/server/services/shopping-list-service';

export const generateShoppingListTool = {
	name: 'generate_shopping_list',
	description: `Lag handleforslag for en uke: rettenes ingredienser (skalert til porsjonene og summert på tvers av retter), minus det som ligger i lageret, pluss det som mangler i bufferen på faste varer.

Mengder trekkes fra når enhetene passer (vekt mot vekt, volum mot volum, antall mot antall). Droppede middager handles ikke inn.

Varer med uncertain=true står på lista fordi beholdningen er usikker: ukjent mengde, en annen enhet enn oppskriften, eller lageret er ikke bekreftet på over to uker. Si det til brukeren med note-teksten — ikke stryk dem og ikke legg dem til som sikre. covered er det som trolig finnes hjemme.`,

	parameters: z.object({
		userId: z.string(),
		weekContext: z.string().describe('ISO week, e.g. "2026-W17"'),
		includeOptional: z.boolean().optional().describe('Include optional ingredients (default false)')
	}),

	execute: async (args: { userId: string; weekContext: string; includeOptional?: boolean }) => {
		const { items, meta, covered } = await buildWeekShoppingList(args.userId, args.weekContext, {
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
				sources: item.sources,
				...(item.uncertain ? { uncertain: true } : {}),
				...(item.note ? { note: item.note } : {})
			})),
			covered,
			uncertainCount: meta.uncertainCount,
			mealCount: meta.mealCount
		};
	}
};
