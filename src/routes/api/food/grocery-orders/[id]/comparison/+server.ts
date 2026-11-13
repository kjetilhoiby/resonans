import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { groceryOrders, groceryOrderLines, shoppingLists } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { compareShoppingListToOrder } from '$lib/domains/food/grocery';
import { type ShoppingListItem } from '$lib/server/services/shopping-list-service';

// GET /api/food/grocery-orders/[id]/comparison — plan vs. kjøp.
// Sammenligner ukas handleliste mot varelinjene fra ALLE ukas handler:
// kjøpte vi det vi planla, hva manglet, hva kom utenom lista? Handlelista er
// en ukesliste, og med Rema-kvitteringer er en uke flere butikkturer — mot én
// av dem alene ville resten av lista stått som «manglet».
export const GET: RequestHandler = async ({ params, locals }) => {
	const userId = locals.userId;

	const order = await db.query.groceryOrders.findFirst({
		where: and(eq(groceryOrders.id, params.id), eq(groceryOrders.userId, userId))
	});
	if (!order) return json({ error: 'Not found' }, { status: 404 });

	// Prioritet: eksplisitt koblet liste → ukas liste på weekContext
	const list = order.shoppingListId
		? await db.query.shoppingLists.findFirst({
				where: and(eq(shoppingLists.id, order.shoppingListId), eq(shoppingLists.userId, userId))
			})
		: await db.query.shoppingLists.findFirst({
				where: and(
					eq(shoppingLists.userId, userId),
					eq(shoppingLists.weekContext, order.weekContext),
					eq(shoppingLists.kind, 'week')
				)
			});

	const weekOrders = await db
		.select({ id: groceryOrders.id })
		.from(groceryOrders)
		.where(and(eq(groceryOrders.userId, userId), eq(groceryOrders.weekContext, order.weekContext)));
	const lines = await db
		.select()
		.from(groceryOrderLines)
		.where(inArray(groceryOrderLines.orderId, weekOrders.map((o) => o.id)));

	if (!list) {
		return json({
			comparison: null,
			reason: 'no_shopping_list',
			weekContext: order.weekContext
		});
	}

	const shoppingItems = (list.items as ShoppingListItem[]).map((item) => ({ text: item.name }));
	const comparison = compareShoppingListToOrder(
		shoppingItems,
		lines.map((line) => ({ name: line.name, category: line.category }))
	);

	return json({
		comparison,
		shoppingListId: list.id,
		weekContext: order.weekContext,
		ordersInWeek: weekOrders.length
	});
};
