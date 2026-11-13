/**
 * Henter dagligvarekjøp (Rema-kvitteringer og Oda-ordrer) som `Purchase`, for
 * `query_groceries`. All regning skjer i `$lib/domains/food/grocery-purchases.ts`.
 *
 * Datoen er `coalesce(delivery_date, order_date)`: Rema-kvitteringer har
 * kjøpsdagen i `order_date` og ingen leveranse, Oda-ordrer er levert når de er
 * handlet.
 */

import { db } from '$lib/db';
import { groceryOrderLines, groceryOrders } from '$lib/db/schema';
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Purchase } from '$lib/domains/food/grocery-purchases';

function num(value: string | null): number | null {
	if (value == null) return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

/**
 * En `date`-kolonne gjennom et `sql`-uttrykk kommer som tekst («2026-11-13») med
 * drizzle-klientens identitetsparser — men tåler en Date om det endrer seg, i
 * stedet for å gi «Fri Nov 13 …» som dato.
 */
function dayString(value: unknown): string | null {
	if (value == null) return null;
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	return String(value).slice(0, 10);
}

export async function loadGroceryPurchases(
	userId: string,
	options: { fromDate: string; toDate: string; provider?: string }
): Promise<Purchase[]> {
	const dateExpr = sql<string>`coalesce(${groceryOrders.deliveryDate}, ${groceryOrders.orderDate})`;
	const conditions = [
		eq(groceryOrders.userId, userId),
		gte(dateExpr, options.fromDate),
		lte(dateExpr, options.toDate)
	];
	if (options.provider) conditions.push(eq(groceryOrders.provider, options.provider));

	const orders = await db
		.select({
			id: groceryOrders.id,
			provider: groceryOrders.provider,
			storeName: groceryOrders.storeName,
			date: dateExpr,
			purchasedAt: groceryOrders.purchasedAt,
			weekContext: groceryOrders.weekContext,
			totalAmount: groceryOrders.totalAmount
		})
		.from(groceryOrders)
		.where(and(...conditions));
	if (orders.length === 0) return [];

	const lines = await db
		.select({
			orderId: groceryOrderLines.orderId,
			name: groceryOrderLines.name,
			ean: groceryOrderLines.ean,
			productGroup: groceryOrderLines.productGroup,
			category: groceryOrderLines.category,
			quantity: groceryOrderLines.quantity,
			unitPrice: groceryOrderLines.unitPrice,
			totalPrice: groceryOrderLines.totalPrice,
			discount: groceryOrderLines.discount
		})
		.from(groceryOrderLines)
		.where(and(eq(groceryOrderLines.userId, userId), inArray(groceryOrderLines.orderId, orders.map((o) => o.id))))
		.orderBy(asc(groceryOrderLines.sortOrder));

	const linesByOrder = new Map<string, Purchase['lines']>();
	for (const line of lines) {
		const list = linesByOrder.get(line.orderId) ?? [];
		list.push({
			name: line.name,
			ean: line.ean,
			productGroup: line.productGroup,
			category: line.category,
			quantity: num(line.quantity),
			unitPrice: num(line.unitPrice),
			totalPrice: num(line.totalPrice),
			discount: num(line.discount)
		});
		linesByOrder.set(line.orderId, list);
	}

	return orders.map((order) => ({
		id: order.id,
		provider: order.provider,
		storeName: order.storeName,
		// WHERE-en krever en dato, så null kan ikke komme hit.
		date: dayString(order.date) ?? options.fromDate,
		purchasedAt: order.purchasedAt ? order.purchasedAt.toISOString() : null,
		weekContext: order.weekContext,
		total: num(order.totalAmount),
		lines: linesByOrder.get(order.id) ?? []
	}));
}

/** Første kjøpsdato vi har, per kilde — så et svar kan si hvor langt dataene rekker. */
export async function groceryCoverage(userId: string) {
	const dateExpr = sql<string>`coalesce(${groceryOrders.deliveryDate}, ${groceryOrders.orderDate})`;
	const rows = await db
		.select({
			provider: groceryOrders.provider,
			first: sql<string>`min(${dateExpr})`,
			last: sql<string>`max(${dateExpr})`,
			count: sql<number>`count(*)::int`
		})
		.from(groceryOrders)
		.where(eq(groceryOrders.userId, userId))
		.groupBy(groceryOrders.provider);
	return rows.map((r) => ({
		provider: r.provider,
		first: dayString(r.first),
		last: dayString(r.last),
		purchases: r.count
	}));
}
