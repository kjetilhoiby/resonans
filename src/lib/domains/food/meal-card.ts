// Middagskortet: én rett med oppskrift, mengder for familien og det familien har
// erfart med den — samlet ett sted. Se
// docs/changelog/2026-11-24-middagsplanen-som-fasit.md.
//
// Erfaringene bor på planraden (meal_plans.notes) for den dagen de ble gjort,
// ikke på retten. «Doblet porsjonen, barna likte det» er en opplysning om en
// kveld, og kortet viser dem samlet med dato. Slik overlever de en sammenslåing
// av duplikater uten å måtte flettes: planradene flyttes, notatene følger med.

import { readMealStatus, type MealLogReading, type MealPlanStatus } from './meal-log';
import { scaleQuantity } from './units';

/**
 * Titler som betyr samme rett: små/store bokstaver, mellomrom og tegnsetting
 * teller ikke. «Ramen» og «ramen med egg» er IKKE det samme — det er en variant,
 * og en variant har sin egen historikk.
 */
export function normalizeMealTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9æøåäöüé]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export type CatalogMeal = { id: string; title: string; createdAt?: Date | string | null };

/** Retter med samme normaliserte tittel, eldste først — den eldste beholdes ved sammenslåing. */
export function findDuplicateGroups<T extends CatalogMeal>(meals: readonly T[]): T[][] {
	const byKey = new Map<string, T[]>();
	for (const meal of meals) {
		const key = normalizeMealTitle(meal.title);
		if (!key) continue;
		byKey.set(key, [...(byKey.get(key) ?? []), meal]);
	}
	return [...byKey.values()]
		.filter((group) => group.length > 1)
		.map((group) =>
			[...group].sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime())
		);
}

export type CardIngredient = { name: string; quantity?: number | null; unit?: string | null; optional?: boolean };

/** Ingrediensene skalert fra oppskriftens porsjoner til familiens. */
export function familyIngredients(
	ingredients: readonly CardIngredient[],
	recipeServings: number,
	familyServings: number
): CardIngredient[] {
	return ingredients.map((ing) => ({
		...ing,
		quantity: scaleQuantity(ing.quantity ?? null, ing.unit, recipeServings, familyServings)
	}));
}

export type CardOccurrence = {
	planId: string;
	date: string;
	reading: MealLogReading;
	notes: string | null;
	servings: number;
};

export type MealCardHistory = {
	timesEaten: number;
	timesSkipped: number;
	lastEaten: string | null;
	nextPlanned: string | null;
	/** Alle forekomster, nyeste først. */
	occurrences: CardOccurrence[];
	/** Erfaringene: forekomster med notat, nyeste først. */
	experiences: Array<{ planId: string; date: string; text: string }>;
};

/** Historikken til én rett, lest fra planradene som peker på den. */
export function buildMealCardHistory(
	plans: ReadonlyArray<{ id: string; date: string; status: MealPlanStatus; notes: string | null; servings: number }>,
	todayIso: string
): MealCardHistory {
	const occurrences = [...plans]
		.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
		.map((p) => ({
			planId: p.id,
			date: p.date,
			reading: readMealStatus(p.status, p.date, todayIso),
			notes: p.notes?.trim() || null,
			servings: p.servings
		}));

	const eaten = occurrences.filter((o) => o.reading === 'eaten');
	const upcoming = occurrences
		.filter((o) => o.reading === 'planned' && o.date >= todayIso)
		.map((o) => o.date)
		.sort();

	return {
		timesEaten: eaten.length,
		timesSkipped: occurrences.filter((o) => o.reading === 'skipped').length,
		lastEaten: eaten[0]?.date ?? null,
		nextPlanned: upcoming[0] ?? null,
		occurrences,
		experiences: occurrences
			.filter((o): o is CardOccurrence & { notes: string } => o.notes != null)
			.map((o) => ({ planId: o.planId, date: o.date, text: o.notes }))
	};
}

export type MergeableMeal = {
	title: string;
	description: string | null;
	ingredients: CardIngredient[];
	instructions: string[];
	prepTimeMin: number | null;
	cookTimeMin: number | null;
	servings: number;
	tags: string[];
	mainProtein: string | null;
	mainCarb: string | null;
	greens: string | null;
	wantMore: boolean;
	effortLevel: string | null;
	imageUrl: string | null;
	sourceUrl: string | null;
	nutritionEstimate: unknown;
};

/**
 * Feltene den beholdte retten får etter en sammenslåing. Den beholdte vinner der
 * den har noe; den andre fyller hullene. Ingrediensene flettes IKKE linje for
 * linje — to lister for samme rett er to oppskrifter, og en blanding av dem er
 * ingen av delene. Er den beholdte tom, tas den andres liste hel.
 */
export function mergeMealFields(keep: MergeableMeal, drop: MergeableMeal): Partial<MergeableMeal> {
	const tagSeen = new Set<string>();
	const tags = [...keep.tags, ...drop.tags].filter((t) => {
		const k = t.trim().toLowerCase();
		if (!k || tagSeen.has(k)) return false;
		tagSeen.add(k);
		return true;
	});
	return {
		description: keep.description || drop.description,
		ingredients: keep.ingredients.length > 0 ? keep.ingredients : drop.ingredients,
		instructions: keep.instructions.length > 0 ? keep.instructions : drop.instructions,
		prepTimeMin: keep.prepTimeMin ?? drop.prepTimeMin,
		cookTimeMin: keep.cookTimeMin ?? drop.cookTimeMin,
		// Porsjonene hører til ingredienslista de skalerer.
		servings: keep.ingredients.length > 0 ? keep.servings : drop.servings,
		tags,
		mainProtein: keep.mainProtein ?? drop.mainProtein,
		mainCarb: keep.mainCarb ?? drop.mainCarb,
		greens: keep.greens ?? drop.greens,
		wantMore: keep.wantMore || drop.wantMore,
		effortLevel: keep.effortLevel ?? drop.effortLevel,
		imageUrl: keep.imageUrl ?? drop.imageUrl,
		sourceUrl: keep.sourceUrl ?? drop.sourceUrl,
		nutritionEstimate: keep.nutritionEstimate ?? drop.nutritionEstimate
	};
}
