/**
 * Protein mot treningsbelastning — kryss-domene-signalet mellom Ernæring og
 * Trening.
 *
 * Dette er den sammenhengen mortemaet finnes for: hverken Ernæring eller
 * Trening kan se den alene. Trening vet hvor mye du belaster kroppen, Ernæring
 * vet hva du tilfører den, og spørsmålet «spiser du nok til det du gjør?» ligger
 * mellom dem.
 *
 * Ren funksjon; produsenten i `signal-service` gjør bare datainnhentingen.
 */

/** Under dette blir uka for tynn til å si noe. */
export const MIN_LOGGED_DAYS = 3;

/**
 * Proteinbehov i g/kg kroppsvekt.
 *
 * 1,2 g/kg er et vanlig utgangspunkt for en voksen som trener litt; 1,7 g/kg er
 * øvre ende av det som gir målbar effekt for styrke og restitusjon. Vi
 * interpolerer mellom dem etter ukens effort framfor å bruke ett fast tall —
 * behovet i en hviluke og i en hard uke er ikke det samme.
 */
export const PROTEIN_G_PER_KG_LOW = 1.2;
export const PROTEIN_G_PER_KG_HIGH = 1.7;

/**
 * Effort-nivået der behovet regnes som «høyt».
 *
 * Samme skala som `weeklyEffort.total` i aggregatene. 400 er valgt fordi det er
 * i overkant av en normal treningsuke i dette datasettet — over det er man i
 * oppbyggingsfase, og da er øvre ende av proteinintervallet den riktige.
 */
export const HIGH_EFFORT_WEEK = 400;

export interface ProteinVsLoadInput {
	/** Snitt protein per logget dag, fra ukesaggregatet. */
	proteinPerDay: number | null;
	loggedDays: number;
	/** `weeklyEffort.total` for samme uke. */
	weeklyEffort: number | null;
	/** Siste kjente kroppsvekt i kg. */
	bodyWeightKg: number | null;
}

export interface ProteinVsLoadResult {
	/** Anbefalt protein per dag, gram. */
	targetPerDay: number;
	actualPerDay: number;
	/** Positivt tall = mangler så mange gram per dag. Negativt = over målet. */
	deficit: number;
	/** Andel av målet, 0–1+. */
	share: number;
	gPerKg: number;
	loggedDays: number;
	weeklyEffort: number;
	severity: 'info' | 'low' | 'medium';
	message: string;
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

function nb(value: number, decimals = 0): string {
	return value.toFixed(decimals).replace('.', ',');
}

/** Interpolerer g/kg mellom lav og høy etter ukens effort. */
export function proteinTargetPerKg(weeklyEffort: number): number {
	if (weeklyEffort <= 0) return PROTEIN_G_PER_KG_LOW;
	const ratio = Math.min(1, weeklyEffort / HIGH_EFFORT_WEEK);
	return round1(PROTEIN_G_PER_KG_LOW + (PROTEIN_G_PER_KG_HIGH - PROTEIN_G_PER_KG_LOW) * ratio);
}

/**
 * Null når grunnlaget ikke holder.
 *
 * Tre krav, og alle tre er der for å unngå å rope om et tall som ikke betyr noe:
 * nok loggede dager, en kjent kroppsvekt å regne mot, og faktisk logget protein.
 * Et signal som sier «du spiser 0 g protein» fordi brukeren ikke logget, er
 * verre enn ingen signal.
 */
export function evaluateProteinVsLoad(input: ProteinVsLoadInput): ProteinVsLoadResult | null {
	const { loggedDays } = input;
	const protein = input.proteinPerDay;
	const weight = input.bodyWeightKg;

	if (loggedDays < MIN_LOGGED_DAYS) return null;
	if (protein == null || protein <= 0) return null;
	if (weight == null || weight <= 0) return null;

	const weeklyEffort = input.weeklyEffort ?? 0;
	const gPerKg = proteinTargetPerKg(weeklyEffort);
	const targetPerDay = Math.round(weight * gPerKg);
	const deficit = Math.round(targetPerDay - protein);
	const share = targetPerDay > 0 ? protein / targetPerDay : 0;

	// Terskler på andel, ikke på gram: 20 g for lite betyr ulike ting for 60 og
	// 100 kg kroppsvekt.
	const severity: ProteinVsLoadResult['severity'] =
		share < 0.7 ? 'medium' : share < 0.9 ? 'low' : 'info';

	const message =
		share >= 0.9
			? `Du får i deg ${nb(protein)} g protein per dag — nok for belastningen (${nb(gPerKg, 1)} g/kg).`
			: `Du får i deg ${nb(protein)} g protein per dag, mot ${targetPerDay} g anbefalt for treningsmengden din. ${deficit} g mer per dag ville dekket det.`;

	return {
		targetPerDay,
		actualPerDay: round1(protein),
		deficit,
		share: Math.round(share * 100) / 100,
		gPerKg,
		loggedDays,
		weeklyEffort: Math.round(weeklyEffort),
		severity,
		message
	};
}
