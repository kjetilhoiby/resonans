/**
 * Makrofordeling: hvor energien kom fra.
 *
 * Flaten har vist gram side om side — 31,2 g protein, 50,9 g karbo, 32,1 g fett —
 * og gram er ikke sammenlignbare. Fett har 9 kcal per gram mot 4 for de to andre,
 * så «mest gram» og «mest energi» er ulike spørsmål. I eksempelet over ser fett
 * minst ut i gram, men er den største energikilden.
 *
 * ## Hvorfor summen ikke stemmer med kcal-tallet
 *
 * `protein·4 + karbo·4 + fett·9` treffer sjelden det loggede kcal-tallet presist.
 * Fiber og alkohol regnes ulikt, og makroene er anslag hver for seg. For
 * eksempeldagen: 617 mot 634 logget, altså 17 kcal på siden.
 *
 * Vi later ikke som avviket ikke finnes. Andelene regnes av **makro-energien**
 * (så de summerer til 100 %), og `unaccountedKcal` sier hva som står utenfor. Å
 * regne andelene av det loggede kcal-tallet ville gitt tre andeler som ikke
 * summerte til hundre, uten at noe forklarte hvorfor.
 */

import type { NutritionMacros } from './estimate';

/** Atwater-faktorene. Fiber og alkohol avviker, som er en del av avviket under. */
export const KCAL_PER_GRAM_PROTEIN = 4;
export const KCAL_PER_GRAM_CARBS = 4;
export const KCAL_PER_GRAM_FAT = 9;

/** Over dette er avviket verdt å nevne på flaten. */
export const UNACCOUNTED_SHARE_WORTH_MENTIONING = 0.1;

export interface MacroSlice {
	key: 'protein' | 'carbs' | 'fat';
	label: string;
	grams: number;
	kcal: number;
	/** Andel av makro-energien, 0–1. De tre summerer til 1. */
	share: number;
}

export interface MacroSplit {
	slices: MacroSlice[];
	/** Energien makroene forklarer. */
	macroKcal: number;
	/** Det loggede kcal-tallet, som kan avvike. */
	loggedKcal: number;
	/** Logget minus makro-energi. Positivt = loggen har mer enn makroene forklarer. */
	unaccountedKcal: number;
	/** Avviket som andel av logget. Null når logget er 0. */
	unaccountedShare: number | null;
	/** Sant når avviket er stort nok til å nevnes. */
	worthMentioning: boolean;
}

/**
 * Null når det ikke er noe å vise — alle tre makroene er null eller mangler.
 *
 * En dag med kcal men uten makroer (mulig for gamle rader) gir også null: en
 * stolpe uten segmenter er verre enn ingen stolpe.
 */
export function macroEnergySplit(macros: NutritionMacros): MacroSplit | null {
	const grams = {
		protein: safe(macros.proteinG),
		carbs: safe(macros.carbsG),
		fat: safe(macros.fatG)
	};

	const kcal = {
		protein: grams.protein * KCAL_PER_GRAM_PROTEIN,
		carbs: grams.carbs * KCAL_PER_GRAM_CARBS,
		fat: grams.fat * KCAL_PER_GRAM_FAT
	};

	const macroKcal = kcal.protein + kcal.carbs + kcal.fat;
	if (macroKcal <= 0) return null;

	const loggedKcal = safe(macros.kcal);
	const unaccountedKcal = Math.round(loggedKcal - macroKcal);
	const unaccountedShare = loggedKcal > 0 ? Math.abs(unaccountedKcal) / loggedKcal : null;

	// Rekkefølgen er fast: protein, karbo, fett. Fargene tildeles i samme
	// rekkefølge, så et segment beholder fargen sin når et annet blir null.
	const slices: MacroSlice[] = [
		{ key: 'protein', label: 'Protein', grams: grams.protein, kcal: Math.round(kcal.protein), share: kcal.protein / macroKcal },
		{ key: 'carbs', label: 'Karbo', grams: grams.carbs, kcal: Math.round(kcal.carbs), share: kcal.carbs / macroKcal },
		{ key: 'fat', label: 'Fett', grams: grams.fat, kcal: Math.round(kcal.fat), share: kcal.fat / macroKcal }
	];

	return {
		slices,
		macroKcal: Math.round(macroKcal),
		loggedKcal: Math.round(loggedKcal),
		unaccountedKcal,
		unaccountedShare,
		worthMentioning:
			unaccountedShare !== null && unaccountedShare > UNACCOUNTED_SHARE_WORTH_MENTIONING
	};
}

function safe(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** «46 %» med norsk formatering. Runder til hele prosent. */
export function formatShare(share: number): string {
	return `${Math.round(share * 100)} %`;
}
