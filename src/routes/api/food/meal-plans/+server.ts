import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { mealPlans } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import {
	upsertMealPlan,
	deleteMealPlan,
	getMealPlansWithTitlesInRange,
	getWeekMealPlansWithTitles,
	type UpsertMealPlanParams
} from '$lib/server/services/meal-plan-sync';
import { isMealPlanStatus, validateStatusForDate } from '$lib/domains/food/meal-log';
import { osloTodayIso } from '$lib/server/iso-week';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// GET ?weekContext=2026-W48 eller ?from=…&to=… — planradene med rettens navn,
// status og takeaway-merke (samme leser som query_food).
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const weekContext = url.searchParams.get('weekContext');
	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');

	if (from && to && ISO_DATE.test(from) && ISO_DATE.test(to)) {
		return json({ mealPlans: await getMealPlansWithTitlesInRange(userId, from, to) });
	}
	if (weekContext) {
		return json({ mealPlans: await getWeekMealPlansWithTitles(userId, weekContext) });
	}
	return json({ error: 'Oppgi weekContext eller from/to' }, { status: 400 });
};

/**
 * Felles validering av status mot datoen: en middag kan ikke være spist før
 * dagen har vært. Datoen er den som vil gjelde ETTER endringen.
 */
async function statusError(
	userId: string,
	body: Record<string, unknown>,
	planId: string | null
): Promise<string | null> {
	if (!('status' in body)) return null;
	if (!isMealPlanStatus(body.status)) return "status må være 'planned', 'eaten' eller 'skipped'";
	let date = typeof body.date === 'string' ? body.date : null;
	if (!date && planId) {
		const existing = await db.query.mealPlans.findFirst({
			where: and(eq(mealPlans.id, planId), eq(mealPlans.userId, userId)),
			columns: { date: true }
		});
		date = existing?.date ?? null;
	}
	return date ? validateStatusForDate(body.status, date, osloTodayIso()) : null;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json();

	if (!body.date || !ISO_DATE.test(body.date) || !body.mealType) {
		return json({ error: 'date (YYYY-MM-DD) og mealType er påkrevd' }, { status: 400 });
	}
	const invalid = await statusError(userId, body, null);
	if (invalid) return json({ error: invalid }, { status: 400 });

	const created = await upsertMealPlan(userId, {
		weekContext: body.weekContext,
		date: body.date,
		mealType: body.mealType,
		mealId: body.mealId ?? undefined,
		mealName: typeof body.mealName === 'string' ? body.mealName : undefined,
		takeaway: body.takeaway === true,
		notes: body.notes ?? null,
		servings: body.servings,
		photoUrl: body.photoUrl ?? null,
		status: body.status
	});

	return json({ mealPlan: created }, { status: 201 });
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json();

	if (!body.id) return json({ error: 'id required' }, { status: 400 });
	if ('date' in body && (typeof body.date !== 'string' || !ISO_DATE.test(body.date))) {
		return json({ error: 'date må være YYYY-MM-DD' }, { status: 400 });
	}
	const invalid = await statusError(userId, body, body.id);
	if (invalid) return json({ error: invalid }, { status: 400 });

	const params: Record<string, unknown> = { id: body.id };
	for (const key of ['date', 'mealType', 'mealId', 'mealName', 'notes', 'servings', 'photoUrl', 'status']) {
		if (key in body) params[key] = body[key];
	}
	if (body.takeaway === true) params.takeaway = true;

	const updated = await upsertMealPlan(userId, params as UpsertMealPlanParams);
	if (!updated) return json({ error: 'Not found' }, { status: 404 });
	return json({ mealPlan: updated });
};

export const DELETE: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'id required' }, { status: 400 });

	const deleted = await deleteMealPlan(userId, id);
	if (!deleted) return json({ error: 'Not found' }, { status: 404 });
	return json({ deleted: true });
};
