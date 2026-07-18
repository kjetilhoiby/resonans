import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	upsertWeekShoppingList,
	withOdaUrl,
	type ShoppingListItem
} from '$lib/server/services/shopping-list-service';

// POST /api/food/shopping-list/generate — bygg/regenerer ukas handleliste.
// Bevarer avhukinger og manuelt tillagte varer fra eksisterende liste.
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json();

	if (!body.weekContext) return json({ error: 'weekContext required' }, { status: 400 });

	const list = await upsertWeekShoppingList(userId, body.weekContext, {
		includeOptional: body.includeOptional === true,
		extraItems: Array.isArray(body.extraItems) ? body.extraItems : []
	});

	return json({
		shoppingList: {
			...list,
			items: (list.items as ShoppingListItem[]).map(withOdaUrl)
		}
	});
};
