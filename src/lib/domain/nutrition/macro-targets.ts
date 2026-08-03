/**
 * Mål for makrobalansen, og avviket fra dem.
 *
 * ## Hvorfor andeler *og* gram
 *
 * Makrobalanse settes naturlig som **andel av energien** — «30 % protein» — fordi
 * det er formen `MacroSplitBar` viser og fordi andelene summerer til noe. Men
 * rådet man trenger er i **gram**: «du mangler 45 g protein» er handlingsrettet,
 * «du mangler 8 prosentpoeng» er det ikke.
 *
 * Derfor regnes begge, og gram-gapet er det som skal brukes i et forslag.
 *
 * ## Proteinmålet står for seg
 *
 * Protein settes ofte i gram per kilo kroppsvekt (1,6–2,0 g/kg for den som trener
 * og vil beholde muskelmasse), ikke som andel. Et absolutt gram-mål vinner derfor
 * over andelen når det finnes — se `proteinTargetG`.
 */

import type { NutritionMacros } from './estimate';

/** Atwater, som i macro-split. */
const KCAL_PER_GRAM = { protein: 4, carbs: 4, fat: 9 } as const;

/** Anbefalt spenn for protein, gram per kg kroppsvekt. */
export const PROTEIN_G_PER_KG_MIN = 1.6;
export const PROTEIN_G_PER_KG_MAX = 2.0;

/** Under dette er avviket for lite til å foreslå noe for. */
export const MEANINGFUL_GAP_G = 10;

export interface MacroTargets {
	/** Dagsmål for energi. */
	kcal?: number | null;
	/** Absolutt proteinmål i gram. Vinner over `proteinPct`. */
	proteinG?: number | null;
	/** Målandeler av energien, 0–100. Trenger ikke summere til 100. */
	proteinPct?: number | null;
	carbsPct?: number | null;
	fatPct?: number | null;
}

export interface MacroStatus {
	key: 'protein' | 'carbs' | 'fat';
	label: string;
	currentG: number;
	/** Målet i gram, utledet av andel × dagsmål der bare andel er satt. */
	targetG: number | null;
	/** Positivt = mangler. Negativt = over. Null uten mål. */
	gapG: number | null;
	currentPct: number;
	targetPct: number | null;
}

export interface MacroTargetEvaluation {
	macros: MacroStatus[];
	kcalTarget: number | null;
	kcalCurrent: number;
	kcalGap: number | null;
	/** Makroen med størst mangel i gram, når den er verdt å nevne. */
	biggestGap: MacroStatus | null;
	/** Sant når ingen mål er satt i det hele tatt. */
	noTargets: boolean;
}

/**
 * Foreslått proteinmål ut fra kroppsvekt.
 *
 * Midt i det anbefalte spennet. Null uten vekt — vi gjetter ikke.
 */
export function suggestedProteinTarget(weightKg: number | null): number | null {
	if (typeof weightKg !== 'number' || weightKg < 30 || weightKg > 300) return null;
	return Math.round(weightKg * ((PROTEIN_G_PER_KG_MIN + PROTEIN_G_PER_KG_MAX) / 2));
}

/**
 * Hvor man ligger mot målene, i både gram og andel.
 *
 * Gram-målet utledes av andelen når bare andelen er satt, og det krever et
 * kcal-mål: 30 % av ingenting er ingenting. Uten kcal-mål blir `targetG` null for
 * de makroene som bare har en andel.
 */
export function evaluateMacroTargets(input: {
	totals: NutritionMacros;
	targets: MacroTargets;
}): MacroTargetEvaluation {
	const { totals, targets } = input;

	const grams = {
		protein: safe(totals.proteinG),
		carbs: safe(totals.carbsG),
		fat: safe(totals.fatG)
	};
	const kcalFromMacros =
		grams.protein * KCAL_PER_GRAM.protein +
		grams.carbs * KCAL_PER_GRAM.carbs +
		grams.fat * KCAL_PER_GRAM.fat;

	const kcalTarget = num(targets.kcal);
	const kcalCurrent = Math.round(safe(totals.kcal));

	const pctTargets = {
		protein: num(targets.proteinPct),
		carbs: num(targets.carbsPct),
		fat: num(targets.fatPct)
	};

	const macros: MacroStatus[] = (['protein', 'carbs', 'fat'] as const).map((key) => {
		const currentG = grams[key];
		const targetPct = pctTargets[key];

		// Absolutt proteinmål vinner: det settes per kg kroppsvekt og er mer presist
		// enn en andel av et kaloribudsjett.
		let targetG: number | null = null;
		if (key === 'protein' && num(targets.proteinG) !== null) {
			targetG = num(targets.proteinG);
		} else if (targetPct !== null && kcalTarget !== null) {
			targetG = Math.round((kcalTarget * (targetPct / 100)) / KCAL_PER_GRAM[key]);
		}

		return {
			key,
			label: key === 'protein' ? 'Protein' : key === 'carbs' ? 'Karbo' : 'Fett',
			currentG: Math.round(currentG * 10) / 10,
			targetG,
			gapG: targetG === null ? null : Math.round(targetG - currentG),
			currentPct:
				kcalFromMacros > 0
					? Math.round(((currentG * KCAL_PER_GRAM[key]) / kcalFromMacros) * 100)
					: 0,
			targetPct
		};
	});

	const withGap = macros.filter(
		(macro): macro is MacroStatus & { gapG: number } =>
			macro.gapG !== null && macro.gapG >= MEANINGFUL_GAP_G
	);
	const biggestGap =
		withGap.length === 0 ? null : withGap.reduce((a, b) => (b.gapG > a.gapG ? b : a));

	return {
		macros,
		kcalTarget,
		kcalCurrent,
		kcalGap: kcalTarget === null ? null : Math.round(kcalTarget - kcalCurrent),
		biggestGap,
		noTargets: kcalTarget === null && macros.every((macro) => macro.targetG === null)
	};
}

function safe(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function num(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
