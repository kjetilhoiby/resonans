import { z } from 'zod';
import { db } from '$lib/db';
import { meals, mealPlans, pantryItems } from '$lib/db/schema';
import { eq, and, gte, lte, desc, asc, ne, sql } from 'drizzle-orm';
import { getMealPlansWithTitlesInRange } from '$lib/server/services/meal-plan-sync';
import { addDaysIso, datesForIsoWeek, osloTodayIso } from '$lib/server/iso-week';
import {
	isFavoriteMeal,
	isTakeawayMeal,
	MEAL_LOG_READING_LABEL,
	readMealStatus,
	summarizeMealHistory
} from '$lib/domains/food/meal-log';

const DEFAULT_HISTORY_DAYS = 28;
const MAX_RANGE_DAYS = 366;

/**
 * Vinduet en plan- eller historikkspørring gjelder. `weekContext` vinner; ellers
 * fromDate/toDate; ellers en standard som passer spørsmålet (planen: denne og
 * neste uke, historikken: siste fire uker). Spennet kappes, så et skrivefeil-år
 * ikke henter hele historikken.
 */
function resolveWindow(
	args: { weekContext?: string; fromDate?: string; toDate?: string; days?: number },
	kind: 'plan' | 'history',
	today: string
): { from: string; to: string } | { error: string } {
	if (args.weekContext) {
		const days = datesForIsoWeek(args.weekContext);
		if (days.length === 0) return { error: `Ugyldig weekContext: ${args.weekContext}` };
		return { from: days[0], to: days[days.length - 1] };
	}
	const iso = /^\d{4}-\d{2}-\d{2}$/;
	if (args.fromDate && !iso.test(args.fromDate)) return { error: 'fromDate må være YYYY-MM-DD' };
	if (args.toDate && !iso.test(args.toDate)) return { error: 'toDate må være YYYY-MM-DD' };

	let from: string;
	let to: string;
	if (kind === 'history') {
		to = args.toDate ?? today;
		from = args.fromDate ?? addDaysIso(to, -((args.days ?? DEFAULT_HISTORY_DAYS) - 1));
	} else {
		from = args.fromDate ?? today;
		to = args.toDate ?? addDaysIso(from, (args.days ?? 14) - 1);
	}
	if (from > to) return { error: `fromDate (${from}) ligger etter toDate (${to})` };
	if (addDaysIso(from, MAX_RANGE_DAYS) < to) {
		from = addDaysIso(to, -MAX_RANGE_DAYS);
	}
	return { from, to };
}

export const queryFoodTool = {
	name: 'query_food',
	description: `Les familiens mat: retter/oppskrifter, middagsplan, middagshistorikk og lager.

queryType:
- 'meal_plan': PLANEN — hva vi skal spise. Standard denne og neste uke; weekContext («2026-W45») eller fromDate/toDate overstyrer. Hver rad har id, dato, rettens navn (mealTitle), status og takeaway.
- 'history': HISTORIKKEN — hva vi faktisk spiste. Standard siste 28 dager (days/fromDate/toDate overstyrer). Gir radene pluss en oppsummering: mest spiste retter med antall og sist spist, droppede planer, takeaway-andel. Bruk dette for «når hadde vi ramen sist», «hva spiser vi mest», «vi har hatt mye pasta i det siste».
- 'meals': kartoteket av retter, med favoritt, takeaway, timesEaten og lastEaten. Ingredienser og fremgangsmåte er med bare når withRecipe=true (tungt).
- 'pantry': lageret, valgfritt filtrert på location (pantry/fridge/freezer).
- 'expiring_soon': varer som går ut innen days dager (standard 7).

Status på en plan- eller historikkrad: 'planned', 'eaten', 'skipped' eller 'unconfirmed'. 'unconfirmed' er en plan på en dag som har vært, uten at noen har bekreftet den — si at den var planlagt, ikke at den ble spist.`,

	parameters: z.object({
		userId: z.string().describe('User ID'),
		queryType: z.enum(['meals', 'meal_plan', 'history', 'pantry', 'expiring_soon']),
		weekContext: z.string().optional().describe('ISO-uke, f.eks. "2026-W45" (meal_plan/history)'),
		fromDate: z.string().optional().describe('YYYY-MM-DD (meal_plan/history)'),
		toDate: z.string().optional().describe('YYYY-MM-DD (meal_plan/history)'),
		mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional().describe('Filtrer plan/historikk på måltid'),
		location: z.enum(['pantry', 'fridge', 'freezer']).optional().describe('Filtrer lageret'),
		days: z.number().optional().describe('history: dager bakover; expiring_soon: dager fram'),
		search: z.string().optional().describe('meals: søk i navnet'),
		favoritesOnly: z.boolean().optional().describe('meals: bare familiefavoritter'),
		withRecipe: z.boolean().optional().describe('meals: ta med ingredienser og fremgangsmåte'),
		limit: z.number().optional()
	}),

	execute: async (args: {
		userId: string;
		queryType: 'meals' | 'meal_plan' | 'history' | 'pantry' | 'expiring_soon';
		weekContext?: string;
		fromDate?: string;
		toDate?: string;
		mealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
		location?: 'pantry' | 'fridge' | 'freezer';
		days?: number;
		search?: string;
		favoritesOnly?: boolean;
		withRecipe?: boolean;
		limit?: number;
	}) => {
		const today = osloTodayIso();

		switch (args.queryType) {
			case 'meals': {
				const rows = await db
					.select()
					.from(meals)
					.where(eq(meals.userId, args.userId))
					.orderBy(desc(meals.createdAt));

				// Bruk = spiste rader. Droppede planer er ikke bruk, og en ren plan er
				// ikke spist ennå — se meal-log.ts.
				const usage = await db
					.select({
						mealId: mealPlans.mealId,
						timesEaten: sql<number>`count(*) filter (where ${mealPlans.status} = 'eaten')::int`,
						lastEaten: sql<string | null>`max(${mealPlans.date}) filter (where ${mealPlans.status} = 'eaten')`,
						nextPlanned: sql<string | null>`min(${mealPlans.date}) filter (where ${mealPlans.status} = 'planned' and ${mealPlans.date} >= ${today})`
					})
					.from(mealPlans)
					.where(and(eq(mealPlans.userId, args.userId), ne(mealPlans.status, 'skipped')))
					.groupBy(mealPlans.mealId);
				const usageByMeal = new Map(usage.map((u) => [u.mealId, u]));

				const needle = args.search?.trim().toLowerCase();
				const filtered = rows.filter(
					(m) =>
						(!needle || m.title.toLowerCase().includes(needle)) &&
						(!args.favoritesOnly || isFavoriteMeal(m.tags))
				);

				const result = filtered.slice(0, args.limit ?? 50).map((m) => {
					const u = usageByMeal.get(m.id);
					return {
						id: m.id,
						title: m.title,
						tags: m.tags,
						favorite: isFavoriteMeal(m.tags),
						wantMore: m.wantMore,
						takeaway: isTakeawayMeal(m.tags),
						effortLevel: m.effortLevel,
						totalMinutes:
							m.prepTimeMin == null && m.cookTimeMin == null
								? null
								: (m.prepTimeMin ?? 0) + (m.cookTimeMin ?? 0),
						servings: m.servings,
						hasRecipe: m.ingredients.length > 0 || m.instructions.length > 0,
						ingredientCount: m.ingredients.length,
						timesEaten: u?.timesEaten ?? 0,
						lastEaten: u?.lastEaten ?? null,
						nextPlanned: u?.nextPlanned ?? null,
						...(args.withRecipe
							? {
									description: m.description,
									ingredients: m.ingredients,
									instructions: m.instructions,
									mainProtein: m.mainProtein,
									mainCarb: m.mainCarb,
									greens: m.greens,
									sourceUrl: m.sourceUrl
								}
							: {})
					};
				});
				return { meals: result, total: filtered.length };
			}

			case 'meal_plan':
			case 'history': {
				const kind = args.queryType === 'history' ? 'history' : 'plan';
				const window = resolveWindow(args, kind, today);
				if ('error' in window) return window;

				const rows = await getMealPlansWithTitlesInRange(args.userId, window.from, window.to, {
					mealType: args.mealType
				});
				const entries = rows.map((r) => {
					const reading = readMealStatus(r.status, r.date, today);
					return {
						id: r.id,
						date: r.date,
						mealType: r.mealType,
						mealId: r.mealId,
						mealTitle: r.mealTitle ?? r.notes ?? null,
						status: reading,
						statusLabel: MEAL_LOG_READING_LABEL[reading],
						takeaway: r.takeaway,
						notes: r.notes,
						servings: r.servings,
						photoUrl: r.photoUrl
					};
				});

				if (kind === 'plan') {
					return { fromDate: window.from, toDate: window.to, today, mealPlans: entries };
				}

				const summary = summarizeMealHistory(
					rows.map((r) => ({
						date: r.date,
						mealType: r.mealType,
						mealId: r.mealId,
						title: r.mealTitle ?? r.notes ?? null,
						status: r.status,
						takeaway: r.takeaway
					})),
					today
				);
				// Historikken er det som har skjedd; framtidige planer hører i meal_plan.
				const past = entries.filter((e) => e.date <= today).reverse();
				return {
					fromDate: window.from,
					toDate: window.to,
					today,
					summary,
					entries: past.slice(0, args.limit ?? 120)
				};
			}

			case 'pantry': {
				const conditions = [eq(pantryItems.userId, args.userId)];
				if (args.location) conditions.push(eq(pantryItems.location, args.location));
				const rows = await db
					.select()
					.from(pantryItems)
					.where(and(...conditions))
					.orderBy(asc(pantryItems.location), asc(pantryItems.name));
				return { pantry: rows };
			}

			case 'expiring_soon': {
				const days = args.days ?? 7;
				const horizon = addDaysIso(today, days);
				const rows = await db
					.select()
					.from(pantryItems)
					.where(
						and(
							eq(pantryItems.userId, args.userId),
							gte(pantryItems.expiresAt, today),
							lte(pantryItems.expiresAt, horizon)
						)
					)
					.orderBy(asc(pantryItems.expiresAt));
				return { expiringSoon: rows, withinDays: days };
			}
		}
	}
};
