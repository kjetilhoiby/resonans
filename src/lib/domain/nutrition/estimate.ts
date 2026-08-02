/**
 * Inntaksestimatet: formen modellen svarer i, og regnestykkene rundt det.
 *
 * Delt mellom server (estimering, logging, aggregering) og klient (visning,
 * redigering). Alt her er rene funksjoner — modellkallet bor i
 * `$lib/server/nutrition/estimate-intake`.
 */

export interface NutritionMacros {
	kcal: number;
	proteinG: number;
	carbsG: number;
	fatG: number;
}

export interface NutritionItem {
	name: string;
	quantity: number | null;
	unit: string | null;
	macros: NutritionMacros;
	/** Nøkkelen i referansetabellen modellen la seg på, når den fant en. */
	referenceKey: string | null;
}

export type EstimateSource = 'text' | 'vision' | 'vision+text' | 'manual';

export interface NutritionEstimate {
	/** Kort beskrivelse av måltidet, egnet som tittel i loggen. */
	label: string;
	items: NutritionItem[];
	totals: NutritionMacros;
	/** 0–1. Et estimat er et estimat; flaten skal aldri vise det som en måling. */
	confidence: number;
	/**
	 * Sann når modellen mangler mengde og gjettet. Da stiller vi `question` til
	 * brukeren i stedet for å lagre et tall vi vet er tynt — det er hele
	 * «beskriv for å få mengde»-løkka.
	 */
	needsQuantity: boolean;
	/** Konkret oppfølgingsspørsmål, f.eks. «Hvor mange knekkebrød?». */
	question: string | null;
	notes: string | null;
	source: EstimateSource;
}

export const EMPTY_MACROS: NutritionMacros = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };

/** Kalorier rundes til hele, gram til én desimal. Mer presisjon er falsk. */
export function roundMacros(macros: NutritionMacros): NutritionMacros {
	return {
		kcal: Math.round(macros.kcal),
		proteinG: Math.round(macros.proteinG * 10) / 10,
		carbsG: Math.round(macros.carbsG * 10) / 10,
		fatG: Math.round(macros.fatG * 10) / 10
	};
}

export function addMacros(a: NutritionMacros, b: NutritionMacros): NutritionMacros {
	return {
		kcal: a.kcal + b.kcal,
		proteinG: a.proteinG + b.proteinG,
		carbsG: a.carbsG + b.carbsG,
		fatG: a.fatG + b.fatG
	};
}

/**
 * Summen av delene, ikke modellens egen totalsum.
 *
 * Modellen svarer med begge, og de spriker: den lister tre varer og oppgir en
 * total som ikke stemmer med dem. Da er delene den sannheten brukeren kan
 * korrigere, så vi regner totalen selv.
 */
export function sumItemMacros(items: NutritionItem[]): NutritionMacros {
	return roundMacros(items.reduce((acc, item) => addMacros(acc, item.macros), EMPTY_MACROS));
}

function finiteNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value.replace(',', '.'));
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

/** Negative makroer finnes ikke; en modell som svarer −5 g protein skal gi 0. */
function nonNegative(value: number | null): number {
	return value != null && value > 0 ? value : 0;
}

function parseMacros(raw: unknown): NutritionMacros {
	const obj = (raw ?? {}) as Record<string, unknown>;
	return {
		kcal: nonNegative(finiteNumber(obj.kcal)),
		proteinG: nonNegative(finiteNumber(obj.proteinG)),
		carbsG: nonNegative(finiteNumber(obj.carbsG)),
		fatG: nonNegative(finiteNumber(obj.fatG))
	};
}

function parseItem(raw: unknown): NutritionItem | null {
	const obj = (raw ?? {}) as Record<string, unknown>;
	const name = typeof obj.name === 'string' ? obj.name.trim() : '';
	if (!name) return null;
	return {
		name,
		quantity: finiteNumber(obj.quantity),
		unit: typeof obj.unit === 'string' && obj.unit.trim() ? obj.unit.trim() : null,
		macros: roundMacros(parseMacros(obj.macros)),
		referenceKey:
			typeof obj.referenceKey === 'string' && obj.referenceKey.trim() ? obj.referenceKey.trim() : null
	};
}

function clampConfidence(value: number | null): number {
	if (value == null) return 0.3;
	return Math.max(0, Math.min(1, value));
}

/**
 * Tolker modellsvaret til et estimat vi tør lagre.
 *
 * Robust med vilje: en LLM svarer med streng der vi ba om tall, hopper over
 * felter, og finner på ekstra. Alternativet — å kaste på første avvik — ville
 * gjort loggingen upålitelig på en måte brukeren ikke kan gjøre noe med.
 */
export function parseEstimateResponse(raw: unknown, source: EstimateSource): NutritionEstimate {
	const obj = (raw ?? {}) as Record<string, unknown>;
	const items = Array.isArray(obj.items)
		? obj.items.map(parseItem).filter((item): item is NutritionItem => item !== null)
		: [];

	const label =
		typeof obj.label === 'string' && obj.label.trim()
			? obj.label.trim()
			: items.length > 0
				? items.map((i) => i.name).join(', ')
				: 'Måltid';

	const question =
		typeof obj.question === 'string' && obj.question.trim() ? obj.question.trim() : null;

	return {
		label,
		items,
		totals: sumItemMacros(items),
		confidence: clampConfidence(finiteNumber(obj.confidence)),
		// Uten varer har vi ingenting — da trengs mengde uansett hva modellen sier.
		needsQuantity: items.length === 0 ? true : obj.needsQuantity === true,
		question,
		notes: typeof obj.notes === 'string' && obj.notes.trim() ? obj.notes.trim() : null,
		source
	};
}

const NB_NUMBER = (value: number, decimals = 0): string =>
	value.toFixed(decimals).replace('.', ',');

/** «≈ 240 kcal · 14 g protein» — én linje til flisen og loggen. */
export function describeMacros(macros: NutritionMacros): string {
	return `${NB_NUMBER(macros.kcal)} kcal · ${NB_NUMBER(macros.proteinG, 0)} g protein`;
}

/** «2 stykk knekkebrød» / «Knekkebrød» når mengden mangler. */
export function describeItem(item: NutritionItem): string {
	if (item.quantity == null) return item.name;
	const quantity = Number.isInteger(item.quantity)
		? String(item.quantity)
		: NB_NUMBER(item.quantity, 1);
	return item.unit ? `${quantity} ${item.unit} ${item.name.toLowerCase()}` : `${quantity} ${item.name.toLowerCase()}`;
}

/**
 * Konfidens som ord. Terskler, ikke prosent: «0,42» later som presisjon vi ikke
 * har, og brukeren skal bare vite om tallet kan brukes eller bør rettes.
 */
export function confidenceLabel(confidence: number): 'lav' | 'middels' | 'god' {
	if (confidence >= 0.7) return 'god';
	if (confidence >= 0.45) return 'middels';
	return 'lav';
}
