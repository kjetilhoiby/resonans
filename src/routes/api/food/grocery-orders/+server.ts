import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { groceryOrders, groceryOrderLines } from '$lib/db/schema';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { addDaysIso, isoWeekKeyForDate, osloTodayIso } from '$lib/server/iso-week';

// GET /api/food/grocery-orders?weekContext=2026-W31 — Oda-ordrer med varelinjer.
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
		.orderBy(desc(groceryOrders.createdAt));

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
