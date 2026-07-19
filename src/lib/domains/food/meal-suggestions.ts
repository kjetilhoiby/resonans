// Middagsforslag for onsdagsøkta — ren, deterministisk scoring uten LLM.
// Favoritter opp, nylig brukte ned, «går snart ut»-ingredienser opp, raske retter opp.
// AI-forslag er en bevisst utsatt utvidelse; chat-fluktveien dekker det behovet.

import { normalizeIngredientName } from './oda';

export type SuggestibleMeal = {
	id: string;
	title: string;
	tags: string[];
	prepTimeMin?: number | null;
	cookTimeMin?: number | null;
	ingredients: Array<{ name: string }>;
	lastPlannedDate: string | null; // ISO-dato
	timesPlanned: number;
	wantMore?: boolean; // «ønsker mer av» — brukerens ambisjon, løfter retten
};

export type DaySuggestion = {
	date: string;
	suggestion: { mealId: string; title: string; reason: string } | null;
	alternatives: Array<{ mealId: string; title: string; reason: string }>;
};

const FAVORITE_TAGS = ['favoritt', 'favorite', 'slager'];
const QUICK_TAGS = ['rask', 'quick', 'enkel'];
const QUICK_TOTAL_MINUTES = 30;
const ALTERNATIVES_PER_DAY = 3;

/** Deterministisk PRNG (mulberry32) — samme seed gir samme ukeforslag. */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function seedFromString(input: string): number {
	let hash = 2166136261;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

function daysBetweenIso(fromIso: string, toIso: string): number {
	const from = Date.UTC(
		Number(fromIso.slice(0, 4)),
		Number(fromIso.slice(5, 7)) - 1,
		Number(fromIso.slice(8, 10))
	);
	const to = Date.UTC(
		Number(toIso.slice(0, 4)),
		Number(toIso.slice(5, 7)) - 1,
		Number(toIso.slice(8, 10))
	);
	return Math.round((to - from) / 86400000);
}

function totalMinutes(meal: SuggestibleMeal): number | null {
	if (meal.prepTimeMin == null && meal.cookTimeMin == null) return null;
	return (meal.prepTimeMin ?? 0) + (meal.cookTimeMin ?? 0);
}

export function scoreMeal(
	meal: SuggestibleMeal,
	opts: { referenceDate: string; expiringPantryNames: string[] }
): { score: number; reasons: string[] } {
	let score = 0;
	const reasons: string[] = [];

	const lowerTags = meal.tags.map((t) => t.toLowerCase());

	if (lowerTags.some((t) => FAVORITE_TAGS.includes(t))) {
		score += 2;
		reasons.push('familiefavoritt');
	}

	if (meal.wantMore) {
		score += 2;
		reasons.push('ønsker mer av');
	}

	if (meal.lastPlannedDate) {
		const days = daysBetweenIso(meal.lastPlannedDate, opts.referenceDate);
		if (days < 14) {
			score -= 3;
		} else if (days <= 28) {
			score -= 1;
		} else {
			reasons.push(`${Math.floor(days / 7)} uker siden sist`);
		}
	} else if (meal.timesPlanned === 0) {
		reasons.push('ikke prøvd ennå');
	}

	const expiring = opts.expiringPantryNames.map(normalizeIngredientName);
	let expiringMatches = 0;
	for (const ing of meal.ingredients) {
		const normalized = normalizeIngredientName(ing.name);
		if (expiring.some((e) => e && (normalized.includes(e) || e.includes(normalized)))) {
			expiringMatches++;
			if (expiringMatches <= 3) {
				score += 1;
				reasons.push(`bruker ${ing.name.toLowerCase()} som går ut snart`);
			}
		}
	}

	const minutes = totalMinutes(meal);
	if (lowerTags.some((t) => QUICK_TAGS.includes(t)) || (minutes != null && minutes <= QUICK_TOTAL_MINUTES)) {
		score += 1;
		if (minutes != null) reasons.push(`rask (${minutes} min)`);
		else reasons.push('rask');
	}

	return { score, reasons };
}

/**
 * Foreslå middager for en liste dager. Deterministisk gitt samme input + seed.
 * Hver rett foreslås maks én gang per uke; alternativene er de neste på lista.
 */
export function suggestWeekDinners(input: {
	days: string[];
	meals: SuggestibleMeal[];
	expiringPantryNames: string[];
	seed: string;
}): DaySuggestion[] {
	const rng = mulberry32(seedFromString(input.seed));

	const scored = input.meals
		.map((meal) => {
			const { score, reasons } = scoreMeal(meal, {
				referenceDate: input.days[0] ?? new Date().toISOString().slice(0, 10),
				expiringPantryNames: input.expiringPantryNames
			});
			// Liten deterministisk jitter så likt scorede retter varierer uke til uke
			return { meal, score: score + rng() * 0.5, reasons };
		})
		.sort((a, b) => b.score - a.score || a.meal.title.localeCompare(b.meal.title, 'nb'));

	const used = new Set<string>();
	const result: DaySuggestion[] = [];

	for (const date of input.days) {
		const available = scored.filter((s) => !used.has(s.meal.id));
		const top = available[0] ?? null;
		if (top) used.add(top.meal.id);

		result.push({
			date,
			suggestion: top
				? {
						mealId: top.meal.id,
						title: top.meal.title,
						reason: top.reasons[0] ?? 'på rotasjon'
					}
				: null,
			alternatives: available.slice(1, 1 + ALTERNATIVES_PER_DAY).map((s) => ({
				mealId: s.meal.id,
				title: s.meal.title,
				reason: s.reasons[0] ?? 'på rotasjon'
			}))
		});
	}

	return result;
}
