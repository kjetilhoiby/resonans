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
import { needsFromPlans, planShopping, type CoveredNeed } from '$lib/domains/food/shopping-needs';

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
	/** Beholdningen er ukjent, gammel eller i en annen enhet — sjekk før du kjøper. */
	uncertain?: boolean;
	/** Hvorfor varen står der (lager, buffer, usikkerhet). */
	note?: string | null;
};

export type AggregatedIngredient = {
	name: string;
	quantity?: number | null;
	unit?: string | null;
	sources: string[];
	uncertain?: boolean;
	note?: string | null;
};

type MealLike = { id: string; title: string; servings: number; ingredients: Ingredient[] };

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
		manual: opts.manual ?? false,
		...(entry.uncertain ? { uncertain: true } : {}),
		...(entry.note ? { note: entry.note } : {})
	};
}

/** Oda-søkelenke for et handleliste-item (beregnes ved lesing, lagres ikke). */
export function withOdaUrl<T extends { name: string }>(item: T): T & { odaUrl: string } {
	return { ...item, odaUrl: odaSearchUrl(item.name) };
}

/**
 * Bygg ukas handleliste: rettenes behov summert i felles enhet, minus det som
 * faktisk ligger hjemme, pluss det som mangler i bufferen på basisvarer.
 * Reglene bor i $lib/domains/food/shopping-needs.ts; her hentes bare dataene.
 */
export async function buildWeekShoppingList(
	userId: string,
	weekContext: string,
	opts: { includeOptional?: boolean; extraItems?: string[] } = {}
): Promise<{
	items: ShoppingListItem[];
	meta: { pantrySkipped: number; mealCount: number; planIds: string[]; uncertainCount: number };
	covered: CoveredNeed[];
}> {
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
	const { items: suggestions, covered } = planShopping({
		needs: needsFromPlans(plans, mealsById, opts),
		stock: pantry.map((p) => ({
			name: p.name,
			quantity: p.quantity != null ? Number(p.quantity) : null,
			unit: p.unit,
			confirmedAt: p.confirmedAt,
			expiresAt: p.expiresAt,
			isStaple: p.isStaple,
			targetQuantity: p.targetQuantity != null ? Number(p.targetQuantity) : null
		})),
		now: new Date(),
		todayIso: osloTodayIso()
	});
	const items = suggestions.map((entry) => toShoppingListItem(entry));

	for (const extra of opts.extraItems ?? []) {
		const name = extra.trim();
		if (!name) continue;
		const normalized = normalizeIngredientName(name);
		if (items.some((item) => item.normalizedName === normalized)) continue;
		items.push(toShoppingListItem({ name, sources: ['manuell'] }, { manual: true }));
	}

	return {
		items,
		covered,
		meta: {
			pantrySkipped: covered.length,
			mealCount: linkedMeals.length,
			planIds: plans.map((p) => p.id),
			uncertainCount: items.filter((item) => item.uncertain).length
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
