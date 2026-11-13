import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { groceryOrders, groceryOrderLines } from '$lib/db/schema';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { addDaysIso, isoWeekKeyForDate, osloTodayIso } from '$lib/server/iso-week';

// GET /api/food/grocery-orders?weekContext=2026-W31 — dagligvareordrer (Oda, Rema 1000) med varelinjer.
// Uten weekContext: ordrer for inneværende + forrige uke.
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const weekContext = url.searchParams.get('weekContext');

	const today = osloTodayIso();
	const conditions = [eq(groceryOrders.userId, userId)];
	if (weekContext) {
		conditions.push(eq(groceryOrders.weekContext, weekContext));
	} else {
		conditions.push(
			inArray(groceryOrders.weekContext, [
				isoWeekKeyForDate(today),
				isoWeekKeyForDate(addDaysIso(today, -7))
			])
		);
	}

	const orders = await db
		.select()
		.from(groceryOrders)
		.where(and(...conditions))
		// Nyeste HANDEL først, ikke nyeste rad: en førstegangssynk av Rema skriver
		// ukas kvitteringer i én bolk, og createdAt sier da ingenting om rekkefølgen.
		.orderBy(
			desc(sql`coalesce(${groceryOrders.purchasedAt}, ${groceryOrders.deliveryDate}::timestamp, ${groceryOrders.orderDate}::timestamp, ${groceryOrders.createdAt})`),
			desc(groceryOrders.createdAt)
		);

	const orderIds = orders.map((o) => o.id);
	const lines = orderIds.length
		? await db
				.select()
				.from(groceryOrderLines)
				.where(inArray(groceryOrderLines.orderId, orderIds))
		: [];

	return json({
		orders: orders.map((order) => ({
			...order,
			lines: lines
				.filter((line) => line.orderId === order.id)
				.sort((a, b) => a.sortOrder - b.sortOrder)
		}))
	});
};
