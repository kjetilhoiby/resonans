/**
 * shopping-list-service.ts — bygger og vedlikeholder ukas handleliste.
 *
 * Aggregerings-logikken (skalering per porsjoner, pantry-subtraksjon, dedup)
 * er flyttet hit fra generate-shopping-list-verktøyet som rene funksjoner,
 * slik at REST-endepunktene, onsdagsøkta og AI-verktøyet deler samme kode.
 * Handlelisten lagres i shopping_lists (én rad per bruker/uke/kind) med
 * normalizedName per vare for Oda-lenker og kvitteringsmatching.
 */

import { db } from '$lib/db';
import { mealPlans, meals, pantryItems, shoppingLists } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { normalizeIngredientName, odaSearchUrl } from '$lib/domains/food/oda';
import { osloTodayIso } from '$lib/server/iso-week';

type Ingredient = {
	name: string;
	quantity?: number | null;
	unit?: string | null;
	optional?: boolean;
};

export type ShoppingListItem = {
	id: string;
	name: string;
	normalizedName: string;
	quantity?: number | null;
	unit?: string | null;
	sources: string[];
	checked: boolean;
	manual: boolean;
};

export type AggregatedIngredient = {
	name: string;
	quantity?: number;
	unit?: string | null;
	sources: string[];
};

type PlanLike = { mealId: string | null; servings: number };
type MealLike = { id: string; title: string; servings: number; ingredients: Ingredient[] };

/**
 * Ekspander ukens planer til aggregerte ingredienser: skaler mengder etter
 * porsjoner, hopp over pantry-treff, slå sammen like varer. Ren funksjon.
 */
export function aggregateIngredients(
	plans: PlanLike[],
	mealsById: Map<string, MealLike>,
	pantryNames: Set<string>,
	opts: { includeOptional?: boolean } = {}
): AggregatedIngredient[] {
	const aggregated = new Map<string, AggregatedIngredient>();

	for (const plan of plans) {
		if (!plan.mealId) continue;
		const meal = mealsById.get(plan.mealId);
		if (!meal) continue;
		const scale = meal.servings > 0 ? plan.servings / meal.servings : 1;

		for (const ing of meal.ingredients) {
			if (ing.optional && !opts.includeOptional) continue;
			const key = normalizeIngredientName(ing.name);
			if (!key || pantryNames.has(key)) continue;

			const existing = aggregated.get(key);
			const scaledQty = ing.quantity != null ? ing.quantity * scale : undefined;
			if (existing) {
				if (scaledQty != null && existing.quantity != null && existing.unit === (ing.unit ?? null)) {
					existing.quantity += scaledQty;
				}
				if (!existing.sources.includes(meal.title)) existing.sources.push(meal.title);
			} else {
				aggregated.set(key, {
					name: ing.name,
					quantity: scaledQty,
					unit: ing.unit ?? null,
					sources: [meal.title]
				});
			}
		}
	}

	return Array.from(aggregated.values());
}

/**
 * Slå sammen en regenerert liste med den eksisterende: avhukinger og manuelt
 * tillagte varer overlever regenerering (match på normalizedName). Ren funksjon.
 */
export function mergeShoppingListItems(
	existing: ShoppingListItem[],
	regenerated: ShoppingListItem[]
): ShoppingListItem[] {
	const existingByName = new Map(existing.map((item) => [item.normalizedName, item]));

	const merged = regenerated.map((item) => {
		const prior = existingByName.get(item.normalizedName);
		return prior ? { ...item, id: prior.id, checked: prior.checked } : item;
	});

	const regeneratedNames = new Set(regenerated.map((item) => item.normalizedName));
	const manualKept = existing.filter(
		(item) => item.manual && !regeneratedNames.has(item.normalizedName)
	);

	return [...merged, ...manualKept];
}

/** Berik en aggregert ingrediens til et handleliste-item. */
export function toShoppingListItem(
	entry: AggregatedIngredient,
	opts: { manual?: boolean } = {}
): ShoppingListItem {
	return {
		id: crypto.randomUUID(),
		name: entry.name,
		normalizedName: normalizeIngredientName(entry.name),
		quantity: entry.quantity ?? null,
		unit: entry.unit ?? null,
		sources: entry.sources,
		checked: false,
		manual: opts.manual ?? false
	};
}

/** Oda-søkelenke for et handleliste-item (beregnes ved lesing, lagres ikke). */
export function withOdaUrl<T extends { name: string }>(item: T): T & { odaUrl: string } {
	return { ...item, odaUrl: odaSearchUrl(item.name) };
}

/** Bygg ukas handleliste fra meal_plans minus pantry (uten å lagre). */
export async function buildWeekShoppingList(
	userId: string,
	weekContext: string,
	opts: { includeOptional?: boolean; extraItems?: string[] } = {}
): Promise<{ items: ShoppingListItem[]; meta: { pantrySkipped: number; mealCount: number; planIds: string[] } }> {
	const plans = await db
		.select()
		.from(mealPlans)
		.where(and(eq(mealPlans.userId, userId), eq(mealPlans.weekContext, weekContext)));

	const mealIds = plans.map((p) => p.mealId).filter((id): id is string => !!id);
	const linkedMeals = mealIds.length
		? await db.select().from(meals).where(and(eq(meals.userId, userId), inArray(meals.id, mealIds)))
		: [];
	const mealsById = new Map<string, MealLike>(
		linkedMeals.map((m) => [m.id, { id: m.id, title: m.title, servings: m.servings, ingredients: m.ingredients as Ingredient[] }])
	);

	const pantry = await db.select().from(pantryItems).where(eq(pantryItems.userId, userId));
	const today = osloTodayIso();
	// Tomme varer (quantity 0) og utgåtte varer teller ikke som «på lager» —
	// de skal ikke undertrykke ingredienser fra oppskriftene.
	const inStock = (p: (typeof pantry)[number]) =>
		!(p.quantity != null && Number(p.quantity) === 0) && !(p.expiresAt && p.expiresAt < today);
	const pantryNames = new Set(pantry.filter(inStock).map((p) => normalizeIngredientName(p.name)));

	const aggregated = aggregateIngredients(plans, mealsById, pantryNames, opts);
	const items = aggregated.map((entry) => toShoppingListItem(entry));

	// Faste varer (staples — frukt/grønt/nøtter m.m.): legg på lista når de er
	// tomme eller utgått, så det alltid finnes lettvinte matpakke-alternativer.
	for (const staple of pantry.filter((p) => p.isStaple && !inStock(p))) {
		const normalized = normalizeIngredientName(staple.name);
		if (items.some((item) => item.normalizedName === normalized)) continue;
		items.push(toShoppingListItem({ name: staple.name, sources: ['fast vare'] }));
	}

	for (const extra of opts.extraItems ?? []) {
		const name = extra.trim();
		if (!name) continue;
		const normalized = normalizeIngredientName(name);
		if (items.some((item) => item.normalizedName === normalized)) continue;
		items.push(toShoppingListItem({ name, sources: ['manuell'] }, { manual: true }));
	}

	return {
		items,
		meta: {
			pantrySkipped: pantryNames.size,
			mealCount: linkedMeals.length,
			planIds: plans.map((p) => p.id)
		}
	};
}

/** Hent ukas handleliste-rad (kind='week'), eller null. */
export async function getWeekShoppingList(userId: string, weekContext: string) {
	return (
		(await db.query.shoppingLists.findFirst({
			where: and(
				eq(shoppingLists.userId, userId),
				eq(shoppingLists.weekContext, weekContext),
				eq(shoppingLists.kind, 'week')
			)
		})) ?? null
	);
}

/**
 * Generer/regenerer ukas handleliste og lagre den. Bevarer avhukinger og
 * manuelle varer fra eksisterende rad via mergeShoppingListItems.
 */
export async function upsertWeekShoppingList(
	userId: string,
	weekContext: string,
	opts: { includeOptional?: boolean; extraItems?: string[] } = {}
) {
	const { items, meta } = await buildWeekShoppingList(userId, weekContext, opts);
	const existing = await getWeekShoppingList(userId, weekContext);

	const finalItems = existing
		? mergeShoppingListItems(existing.items as ShoppingListItem[], items)
		: items;

	if (existing) {
		const [updated] = await db
			.update(shoppingLists)
			.set({ items: finalItems, meta, generatedAt: new Date(), updatedAt: new Date() })
			.where(eq(shoppingLists.id, existing.id))
			.returning();
		return updated;
	}

	const [created] = await db
		.insert(shoppingLists)
		.values({ userId, weekContext, kind: 'week', items: finalItems, meta })
		.returning();
	return created;
}
