// Rettstruktur — komponerte middager som sammensetninger av hovedprotein +
// hovedkarb + grønt. Gjør det enkelt å generere varianter ved å bytte én akse.
// Komplette retter (suppe, taco, pizza, pannekaker) lar aksene stå tomme og
// behandles som hele retter — modellen er alltid frivillig.

import { mulberry32, seedFromString } from './meal-suggestions';

export type CompositionAxis = 'protein' | 'carb' | 'greens';

export type CompositionOption = {
	key: string;
	label: string;
	emoji: string;
	/** Synonymer for å normalisere fritekst/importerte oppskrifter til kanonisk nøkkel. */
	synonyms: string[];
};

// Kanonisk vokabular. Brukeren nevnte kjøtt/fisk/torsk/kylling/svin og
// pasta/potet/ris eksplisitt; resten er vanlige familie-tillegg.
export const PROTEINS: CompositionOption[] = [
	{ key: 'kjott', label: 'Kjøtt', emoji: '🥩', synonyms: ['kjøtt', 'kjott', 'kjøttdeig', 'kjøttkaker', 'biff', 'karbonade', 'storfe', 'lam'] },
	{ key: 'kylling', label: 'Kylling', emoji: '🍗', synonyms: ['kylling', 'kyllingfilet', 'kyllinglår', 'kyllingvinger', 'høne'] },
	{ key: 'svin', label: 'Svin', emoji: '🥓', synonyms: ['svin', 'svinekjøtt', 'kotelett', 'ribbe', 'bacon', 'pølse'] },
	{ key: 'fisk', label: 'Fisk', emoji: '🐟', synonyms: ['fisk', 'laks', 'ørret', 'orret', 'sei', 'makrell', 'fiskekaker'] },
	{ key: 'torsk', label: 'Torsk', emoji: '🎣', synonyms: ['torsk', 'hvit fisk', 'hyse', 'lyr', 'sei'] },
	{ key: 'vegetar', label: 'Vegetar', emoji: '🫘', synonyms: ['vegetar', 'bønner', 'bonner', 'linser', 'kikerter', 'tofu', 'quorn'] },
	{ key: 'egg', label: 'Egg', emoji: '🥚', synonyms: ['egg', 'omelett', 'eggerøre'] }
];

export const CARBS: CompositionOption[] = [
	{ key: 'pasta', label: 'Pasta', emoji: '🍝', synonyms: ['pasta', 'spaghetti', 'makaroni', 'penne', 'fusilli', 'lasagne'] },
	{ key: 'potet', label: 'Potet', emoji: '🥔', synonyms: ['potet', 'poteter', 'potetmos', 'bakt potet', 'pommes'] },
	{ key: 'ris', label: 'Ris', emoji: '🍚', synonyms: ['ris', 'jasminris', 'basmati', 'risotto'] },
	{ key: 'brod', label: 'Brød', emoji: '🍞', synonyms: ['brød', 'brod', 'baguette', 'rundstykker', 'wraps', 'tortilla'] },
	{ key: 'couscous', label: 'Couscous', emoji: '🌾', synonyms: ['couscous', 'bulgur', 'quinoa'] },
	{ key: 'nudler', label: 'Nudler', emoji: '🍜', synonyms: ['nudler', 'nudel', 'noodles'] }
];

export const GREENS: CompositionOption[] = [
	{ key: 'salat', label: 'Salat', emoji: '🥗', synonyms: ['salat', 'grønn salat', 'blandet salat', 'råkost'] },
	{ key: 'kokte-gronnsaker', label: 'Kokte grønnsaker', emoji: '🥦', synonyms: ['kokte grønnsaker', 'brokkoli', 'blomkål', 'erter', 'grønnsaker'] },
	{ key: 'ovnsbakte-gronnsaker', label: 'Ovnsbakte grønnsaker', emoji: '🫑', synonyms: ['ovnsbakte grønnsaker', 'bakte grønnsaker', 'grillede grønnsaker'] },
	{ key: 'rotgronnsaker', label: 'Rotgrønnsaker', emoji: '🥕', synonyms: ['rotgrønnsaker', 'gulrot', 'kålrot', 'rotmos'] },
	{ key: 'wok', label: 'Wokgrønnsaker', emoji: '🥬', synonyms: ['wokgrønnsaker', 'wok', 'stekte grønnsaker'] }
];

export const COMPOSITION_AXES: Record<CompositionAxis, { label: string; options: CompositionOption[] }> = {
	protein: { label: 'Hovedprotein', options: PROTEINS },
	carb: { label: 'Hovedkarbo', options: CARBS },
	greens: { label: 'Grønt', options: GREENS }
};

function optionsFor(axis: CompositionAxis): CompositionOption[] {
	return COMPOSITION_AXES[axis].options;
}

/**
 * Normalisér fritekst til kanonisk nøkkel for en akse.
 * Returnerer kjent nøkkel hvis den finnes, ellers trimmet lowercase (custom tillates),
 * eller null for tom input.
 */
export function normalizeComponent(axis: CompositionAxis, input: string | null | undefined): string | null {
	const text = (input ?? '').trim().toLowerCase();
	if (!text) return null;
	for (const option of optionsFor(axis)) {
		if (option.key === text) return option.key;
		if (option.synonyms.some((s) => s === text || text.includes(s))) return option.key;
	}
	return text;
}

/** Slå opp visningsetikett for en akse-nøkkel; ukjente nøkler tittel-cases. */
export function componentLabel(axis: CompositionAxis, key: string | null | undefined): string | null {
	if (!key) return null;
	const option = optionsFor(axis).find((o) => o.key === key);
	if (option) return option.label;
	return key.charAt(0).toUpperCase() + key.slice(1);
}

export function componentEmoji(axis: CompositionAxis, key: string | null | undefined): string {
	if (!key) return '';
	return optionsFor(axis).find((o) => o.key === key)?.emoji ?? '';
}

export type MealComposition = {
	mainProtein?: string | null;
	mainCarb?: string | null;
	greens?: string | null;
};

/** En rett regnes som komponert når den har både hovedprotein og hovedkarb. */
export function isComposed(meal: MealComposition): boolean {
	return Boolean(meal.mainProtein && meal.mainCarb);
}

/** Bygg en lesbar tittel fra en sammensetning, f.eks. «Kylling med ris og brokkoli». */
export function composedTitle(comp: MealComposition): string {
	const protein = componentLabel('protein', comp.mainProtein);
	const carb = componentLabel('carb', comp.mainCarb);
	const greens = componentLabel('greens', comp.greens);
	if (!protein || !carb) return protein ?? carb ?? '';
	const base = `${protein} med ${carb.toLowerCase()}`;
	return greens ? `${base} og ${greens.toLowerCase()}` : base;
}

export type CompositionVariant = {
	mainProtein: string;
	mainCarb: string;
	greens: string | null;
	title: string;
	reason: string;
};

function comboKey(protein: string, carb: string, greens: string | null): string {
	return `${protein}|${carb}|${greens ?? ''}`;
}

/**
 * Generér nye rett-varianter ved å rekombinere proteiner/karbo/grønt som allerede
 * finnes i repertoaret — uten å gjenta kombinasjoner brukeren allerede har.
 * Deterministisk gitt samme input + seed. Kilden er brukerens egne retter, så
 * forslagene holder seg innenfor det familien faktisk spiser.
 */
export function generateVariants(input: {
	meals: MealComposition[];
	seed: string;
	limit?: number;
}): CompositionVariant[] {
	const composed = input.meals.filter(isComposed);
	if (composed.length === 0) return [];

	const proteins = [...new Set(composed.map((m) => m.mainProtein!).filter(Boolean))];
	const carbs = [...new Set(composed.map((m) => m.mainCarb!).filter(Boolean))];
	const greensSet = [...new Set(composed.map((m) => m.greens).filter((g): g is string => Boolean(g)))];
	// Grønt er valgfritt — null representerer «uten fast tilbehør».
	const greensOptions: Array<string | null> = greensSet.length > 0 ? [...greensSet, null] : [null];

	const existing = new Set(
		composed.map((m) => comboKey(m.mainProtein!, m.mainCarb!, m.greens ?? null))
	);

	const candidates: CompositionVariant[] = [];
	for (const protein of proteins) {
		for (const carb of carbs) {
			for (const greens of greensOptions) {
				const key = comboKey(protein, carb, greens);
				if (existing.has(key)) continue;
				const title = composedTitle({ mainProtein: protein, mainCarb: carb, greens });
				if (!title) continue;
				candidates.push({
					mainProtein: protein,
					mainCarb: carb,
					greens,
					title,
					reason: 'ny vri på kjente råvarer'
				});
			}
		}
	}

	// Deterministisk stokking (Fisher–Yates med seedet PRNG) så forslagene
	// varierer forutsigbart mellom uker/seeds.
	const rng = mulberry32(seedFromString(input.seed));
	for (let i = candidates.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[candidates[i], candidates[j]] = [candidates[j], candidates[i]];
	}

	return candidates.slice(0, input.limit ?? 12);
}
