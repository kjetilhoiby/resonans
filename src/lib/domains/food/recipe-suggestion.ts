// Ren normalisering av et LLM-oppskriftsforslag til et trygt, typet objekt.
// Ingen DB-/nettverkskobling, så det kan enhetstestes uten mocking.

import { FAMILY_DEFAULT_SERVINGS } from './index';
import { normalizeComponent } from './composition';

export type SuggestedRecipe = {
	title: string;
	description: string | null;
	ingredients: Array<{ name: string; quantity: number | null; unit: string | null }>;
	instructions: string[];
	prepTimeMin: number | null;
	cookTimeMin: number | null;
	servings: number;
	tags: string[];
	mainProtein: string | null;
	mainCarb: string | null;
	greens: string | null;
	effortLevel: 'lav' | 'middels' | 'høy' | null;
	nutritionEstimate: { kcal?: number; proteinG?: number; source: 'recipe-derived' } | null;
	note: string | null;
};

/**
 * Tolererer manglende/rare felt fra modellen; sammensetning normaliseres til
 * kanoniske nøkler, porsjoner faller tilbake til familiestandard.
 */
export function normalizeSuggestion(parsed: Record<string, unknown>, fallbackTitle: string): SuggestedRecipe {
	const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
	const servingsRaw = num(parsed.servings);

	const nutritionRaw = parsed.nutritionEstimate as { kcal?: unknown; proteinG?: unknown } | undefined;
	const kcal = num(nutritionRaw?.kcal);
	const proteinG = num(nutritionRaw?.proteinG);

	const effortRaw = typeof parsed.effortLevel === 'string' ? parsed.effortLevel.toLowerCase() : null;
	const effortLevel =
		effortRaw === 'lav' || effortRaw === 'middels' || effortRaw === 'høy' ? effortRaw : null;

	return {
		title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : fallbackTitle,
		description: typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description.trim() : null,
		ingredients: Array.isArray(parsed.ingredients)
			? (parsed.ingredients as Array<Record<string, unknown>>)
					.filter((ing) => ing && typeof ing.name === 'string' && (ing.name as string).trim())
					.map((ing) => ({
						name: String(ing.name).trim(),
						quantity: num(ing.quantity),
						unit: typeof ing.unit === 'string' && ing.unit.trim() ? String(ing.unit).trim() : null
					}))
			: [],
		instructions: Array.isArray(parsed.instructions)
			? (parsed.instructions as unknown[]).map((s) => String(s).trim()).filter(Boolean)
			: [],
		prepTimeMin: num(parsed.prepTimeMin),
		cookTimeMin: num(parsed.cookTimeMin),
		servings: servingsRaw != null && servingsRaw > 0 ? servingsRaw : FAMILY_DEFAULT_SERVINGS,
		tags: Array.isArray(parsed.tags)
			? (parsed.tags as unknown[]).map((t) => String(t).trim().toLowerCase()).filter(Boolean)
			: [],
		mainProtein: normalizeComponent('protein', typeof parsed.mainProtein === 'string' ? parsed.mainProtein : null),
		mainCarb: normalizeComponent('carb', typeof parsed.mainCarb === 'string' ? parsed.mainCarb : null),
		greens: normalizeComponent('greens', typeof parsed.greens === 'string' ? parsed.greens : null),
		effortLevel,
		nutritionEstimate:
			kcal != null || proteinG != null
				? { ...(kcal != null ? { kcal } : {}), ...(proteinG != null ? { proteinG } : {}), source: 'recipe-derived' }
				: null,
		note: typeof parsed.note === 'string' && parsed.note.trim() ? parsed.note.trim() : null
	};
}
