import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { groceryOrders, groceryOrderLines, pantryItems } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { isFoodLine, normalizeGroceryName } from '$lib/domains/food/grocery';

// POST /api/food/grocery-orders/[id]/apply-pantry — «Legg matvarene i lager».
// Ett-trykks bekreftelse (ikke automatisk): matvarelinjer upsertes mot
// pantry_items; pant/gebyr/husholdning og alt lagt inn tidligere
// (line.pantryItemId satt) hoppes over. Body: { excludeLineIds?: string[] }.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const userId = locals.userId;
	const body = await request.json().catch(() => ({}));
	const exclude = new Set<string>(Array.isArray(body.excludeLineIds) ? body.excludeLineIds : []);

	const order = await db.query.groceryOrders.findFirst({
		where: and(eq(groceryOrders.id, params.id), eq(groceryOrders.userId, userId))
	});
	if (!order) return json({ error: 'Not found' }, { status: 404 });

	// Hent linjer og HELE lageret én gang — matching skjer i JS (toveis
	// inneslutning på normaliserte navn: «tine lettmelk» ↔ «lettmelk»).
	const [lines, pantry] = await Promise.all([
		db.select().from(groceryOrderLines).where(eq(groceryOrderLines.orderId, order.id)),
		db.select().from(pantryItems).where(eq(pantryItems.userId, userId))
	]);

	const pantryNormalized = pantry.map((item) => ({
		item,
		normalized: normalizeGroceryName(item.name)
	}));

	function findPantryMatch(lineNormalized: string) {
		if (!lineNormalized) return null;
		return (
			pantryNormalized.find((p) => p.normalized === lineNormalized) ??
			pantryNormalized.find(
				(p) =>
					p.normalized.length >= 3 &&
					lineNormalized.length >= 3 &&
					(lineNormalized.includes(p.normalized) || p.normalized.includes(lineNormalized))
			) ??
			null
		);
	}

	let applied = 0;
	let skipped = 0;

	for (const line of lines) {
		if (exclude.has(line.id) || line.pantryItemId || !isFoodLine(line)) {
			skipped++;
			continue;
		}

		const normalized = normalizeGroceryName(line.name);
		const match = findPantryMatch(normalized);

		let pantryItemId: string;
		if (match) {
			const existing = match.item;
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
			existing.quantity = newQty;
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
				.returning();
			// Nye varer skal kunne matches av senere linjer i samme kvittering
			pantryNormalized.push({ item: created, normalized: normalizeGroceryName(created.name) });
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
