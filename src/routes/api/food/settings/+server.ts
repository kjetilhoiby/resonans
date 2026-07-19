import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { foodSettings } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

// GET /api/food/settings — matinnstillinger (ukebudsjett, ukerytme, onboarding)
export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	const settings = await db.query.foodSettings.findFirst({
		where: eq(foodSettings.userId, userId)
	});
	return json({
		settings: settings ?? {
			userId,
			groceryBudgetWeekly: null,
			weekRhythmNote: null,
			onboardedAt: null
		}
	});
};

// PATCH /api/food/settings
// Body: { groceryBudgetWeekly?: number | null, weekRhythmNote?: string | null, markOnboarded?: boolean }
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
	if ('weekRhythmNote' in body) {
		updates.weekRhythmNote = body.weekRhythmNote ? String(body.weekRhythmNote).slice(0, 2000) : null;
	}
	if (body.markOnboarded === true) {
		updates.onboardedAt = new Date();
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
			groceryBudgetWeekly: (updates.groceryBudgetWeekly as string | null) ?? null,
			weekRhythmNote: (updates.weekRhythmNote as string | null) ?? null,
			onboardedAt: (updates.onboardedAt as Date | undefined) ?? null
		})
		.returning();
	return json({ settings: created }, { status: 201 });
};
