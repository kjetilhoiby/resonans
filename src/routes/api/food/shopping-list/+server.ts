import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getWeekShoppingList,
	withOdaUrl,
	type ShoppingListItem
} from '$lib/server/services/shopping-list-service';

// GET /api/food/shopping-list?weekContext=2026-W31 — ukas handleliste med Oda-lenker
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const weekContext = url.searchParams.get('weekContext');
	if (!weekContext) return json({ error: 'weekContext required' }, { status: 400 });

	const list = await getWeekShoppingList(userId, weekContext);
	if (!list) return json({ shoppingList: null });

	return json({
		shoppingList: {
			...list,
			items: (list.items as ShoppingListItem[]).map(withOdaUrl)
		}
	});
};
