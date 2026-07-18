import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { mealPlans } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { FAMILY_DEFAULT_SERVINGS } from '$lib/domains/food';
import {
	upsertMealPlan,
	deleteMealPlan,
	getWeekMealPlansWithTitles
} from '$lib/server/services/meal-plan-sync';
import { findOrCreateMealId } from '$lib/server/task-intent-parser';

type DayInput = {
	date: string;
	meals: Array<{ mealId?: string; mealTitle?: string }>;
};

// POST /api/food/week-session/plan — lagre middagsvalgene fra onsdagsøkta.
// Diffes per dag mot eksisterende dinner-planer: gjenbruk rader der mulig,
// opprett nye, slett fjernede. Synk til ukeplanen skjer via upsert/delete.
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = (await request.json()) as {
		weekContext?: string;
		servings?: number;
		days?: DayInput[];
	};

	if (!body.weekContext || !Array.isArray(body.days)) {
		return json({ error: 'weekContext og days er påkrevd' }, { status: 400 });
	}
	const servings = body.servings ?? FAMILY_DEFAULT_SERVINGS;

	for (const day of body.days) {
		if (!day.date) continue;

		const existing = await db
			.select()
			.from(mealPlans)
			.where(
				and(
					eq(mealPlans.userId, userId),
					eq(mealPlans.date, day.date),
					eq(mealPlans.mealType, 'dinner')
				)
			);

		// Løs ønskede mealIds (fritekst → findOrCreateMealId)
		const desired: string[] = [];
		for (const choice of day.meals ?? []) {
			const mealId =
				choice.mealId ??
				(choice.mealTitle ? await findOrCreateMealId(userId, choice.mealTitle) : null);
			if (mealId) desired.push(mealId);
		}

		const keep = new Set<string>();
		const toCreate: string[] = [];
		const unmatched = [...existing];

		for (const mealId of desired) {
			const matchIndex = unmatched.findIndex((plan) => plan.mealId === mealId);
			if (matchIndex >= 0) {
				keep.add(unmatched[matchIndex].id);
				unmatched.splice(matchIndex, 1);
			} else {
				toCreate.push(mealId);
			}
		}

		// Gjenbruk overtallige rader for nye valg (oppdater i stedet for slett+opprett)
		for (const mealId of [...toCreate]) {
			const reusable = unmatched.shift();
			if (!reusable) break;
			await upsertMealPlan(userId, { id: reusable.id, mealId, servings });
			keep.add(reusable.id);
			toCreate.splice(toCreate.indexOf(mealId), 1);
		}

		for (const mealId of toCreate) {
			await upsertMealPlan(userId, {
				weekContext: body.weekContext,
				date: day.date,
				mealType: 'dinner',
				mealId,
				servings
			});
		}

		for (const plan of unmatched) {
			await deleteMealPlan(userId, plan.id);
		}
	}

	const saved = await getWeekMealPlansWithTitles(userId, body.weekContext);
	return json({ weekContext: body.weekContext, mealPlans: saved });
};
