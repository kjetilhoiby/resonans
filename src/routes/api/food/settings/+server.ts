import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { foodSettings } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

// GET /api/food/settings — matinnstillinger (ukebudsjett for dagligvarer)
export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	const settings = await db.query.foodSettings.findFirst({
		where: eq(foodSettings.userId, userId)
	});
	return json({
		settings: settings ?? { userId, groceryBudgetWeekly: null }
	});
};

// PATCH /api/food/settings — body: { groceryBudgetWeekly?: number | null }
export const PATCH: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json();

	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if ('groceryBudgetWeekly' in body) {
		const value = body.groceryBudgetWeekly;
		if (value !== null && (typeof value !== 'number' || value < 0)) {
			return json({ error: 'groceryBudgetWeekly must be a non-negative number or null' }, { status: 400 });
		}
		updates.groceryBudgetWeekly = value != null ? String(value) : null;
	}

	const [updated] = await db
		.update(foodSettings)
		.set(updates)
		.where(eq(foodSettings.userId, userId))
		.returning();
	if (updated) return json({ settings: updated });

	const [created] = await db
		.insert(foodSettings)
		.values({
			userId,
			groceryBudgetWeekly: (updates.groceryBudgetWeekly as string | null) ?? null
		})
		.returning();
	return json({ settings: created }, { status: 201 });
};
