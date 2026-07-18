import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { groceryOrders, groceryOrderLines, pantryItems } from '$lib/db/schema';
import { and, eq, ilike } from 'drizzle-orm';
import { isFoodLine, normalizeGroceryName } from '$lib/domains/food/grocery';

// POST /api/food/grocery-orders/[id]/apply-pantry — «Legg matvarene i lager».
// Ett-trykks bekreftelse (ikke automatisk): matvarelinjer upsertes mot
// pantry_items på normalisert navn; pant/gebyr/husholdning hoppes over.
// Body: { excludeLineIds?: string[] } for avhuking.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const userId = locals.userId;
	const body = await request.json().catch(() => ({}));
	const exclude = new Set<string>(Array.isArray(body.excludeLineIds) ? body.excludeLineIds : []);

	const order = await db.query.groceryOrders.findFirst({
		where: and(eq(groceryOrders.id, params.id), eq(groceryOrders.userId, userId))
	});
	if (!order) return json({ error: 'Not found' }, { status: 404 });

	const lines = await db
		.select()
		.from(groceryOrderLines)
		.where(eq(groceryOrderLines.orderId, order.id));

	let applied = 0;
	let skipped = 0;

	for (const line of lines) {
		if (exclude.has(line.id) || line.pantryItemId || !isFoodLine(line)) {
			skipped++;
			continue;
		}

		const normalized = normalizeGroceryName(line.name);
		if (!normalized) {
			skipped++;
			continue;
		}

		// Finn eksisterende lagervare på normalisert navn (case-insensitivt)
		const escaped = normalized.replace(/[\\%_]/g, (ch) => `\\${ch}`);
		const [existing] = await db
			.select()
			.from(pantryItems)
			.where(and(eq(pantryItems.userId, userId), ilike(pantryItems.name, `%${escaped}%`)))
			.limit(1);

		let pantryItemId: string;
		if (existing) {
			const addQty = line.quantity != null ? Number(line.quantity) : null;
			const newQty =
				addQty != null && existing.quantity != null
					? String(Number(existing.quantity) + addQty)
					: addQty != null
						? String(addQty)
						: existing.quantity;
			await db
				.update(pantryItems)
				.set({ quantity: newQty, addedAt: new Date() })
				.where(eq(pantryItems.id, existing.id));
			pantryItemId = existing.id;
		} else {
			const [created] = await db
				.insert(pantryItems)
				.values({
					userId,
					name: line.name,
					location: line.pantryLocationGuess ?? 'pantry',
					quantity: line.quantity,
					unit: line.unit
				})
				.returning({ id: pantryItems.id });
			pantryItemId = created.id;
		}

		await db
			.update(groceryOrderLines)
			.set({ pantryItemId })
			.where(eq(groceryOrderLines.id, line.id));
		applied++;
	}

	await db
		.update(groceryOrders)
		.set({ pantryAppliedAt: new Date(), updatedAt: new Date() })
		.where(eq(groceryOrders.id, order.id));

	return json({ applied, skipped });
};
