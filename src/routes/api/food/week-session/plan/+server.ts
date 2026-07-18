import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { mealPlans } from '$lib/db/schema';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
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
// Diffes per dag mot eksisterende dinner-planer MED måltid: gjenbruk rader der
// mulig (bevarer rad-id-en ukeplan-punktet peker på), opprett nye, slett
// fjernede. Planer uten mealId (rene notat-planer) ligger utenfor øktas modell
// og røres aldri. Synk til ukeplanen skjer via upsert/delete.
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

	// Alle ukas dinner-planer i én spørring (diffes per dag under)
	const dates = body.days.map((d) => d.date).filter(Boolean);
	const allExisting = dates.length
		? await db
				.select()
				.from(mealPlans)
				.where(
					and(
						eq(mealPlans.userId, userId),
						eq(mealPlans.mealType, 'dinner'),
						isNotNull(mealPlans.mealId),
						inArray(mealPlans.date, dates)
					)
				)
		: [];

	for (const day of body.days) {
		if (!day.date) continue;
		const existing = allExisting.filter((plan) => plan.date === day.date);

		// Løs ønskede mealIds (fritekst → findOrCreateMealId, eksakt match —
		// «Taco» skal ikke kobles til «Tacosuppe»)
		const desired: string[] = [];
		for (const choice of day.meals ?? []) {
			const mealId =
				choice.mealId ??
				(choice.mealTitle
					? await findOrCreateMealId(userId, choice.mealTitle, { match: 'exact' })
					: null);
			if (mealId) desired.push(mealId);
		}

		const toCreate: string[] = [];
		const unmatched = [...existing];

		for (const mealId of desired) {
			const matchIndex = unmatched.findIndex((plan) => plan.mealId === mealId);
			if (matchIndex >= 0) {
				unmatched.splice(matchIndex, 1);
			} else {
				toCreate.push(mealId);
			}
		}

		// Gjenbruk overtallige rader for nye valg — bevarer rad-id-en som
		// ukeplan-punktets linkedMealPlanId peker på. date/weekContext settes
		// eksplisitt så en rad med avvikende weekContext normaliseres.
		while (toCreate.length > 0 && unmatched.length > 0) {
			const reusable = unmatched.shift()!;
			const mealId = toCreate.shift()!;
			await upsertMealPlan(userId, {
				id: reusable.id,
				mealId,
				servings,
				date: day.date,
				weekContext: body.weekContext
			});
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
