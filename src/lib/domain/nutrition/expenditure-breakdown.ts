/**
 * Hva «forbrent» består av, og når tallet ikke henger sammen.
 *
 * Flaten har vist ett tall — «Forbrent 2 763 kcal» — hentet rått fra Withings'
 * `totalCalories`. Det er hvileforbrenning pluss aktivitet, men brukeren ser bare
 * summen og kan ikke vurdere om den er rimelig. Spørsmålet «hvorfor mener den at
 * jeg har forbrent 2,7k?» er derfor helt betimelig, og svaret lå ikke i appen.
 *
 * ## De to tallene Withings gir
 *
 * - `calories` — **bare** aktivitet.
 * - `totalCalories` — hvileforbrenning + aktivitet.
 *
 * Differansen er hvileforbrenningen, og den er stabil: over 31. juli–2. august lå
 * den på 1 954, 1 971 og 1 958. Vi utleder den derfor som medianen over flere
 * dager framfor å regne på høyde og vekt.
 *
 * ## Hvorfor avstemmingen må sjekkes
 *
 * 3. august ga Withings `calories = 1 460` og `totalCalories = 2 763`. Med en
 * hvileforbrenning rundt 1 960 skulle totalen vært ~3 420. Feltene oppdateres
 * retroaktivt gjennom dagen og tydeligvis ikke i takt, så en delvis dag kan ha
 * internt uenige komponenter.
 *
 * Det er ikke vår feil å rette, men det er vår feil å skjule. `reconciles: false`
 * lar flaten si at tallet er i bevegelse.
 */

/** Hvor stort avvik vi godtar før komponentene kalles uenige. */
export const RECONCILE_TOLERANCE_KCAL = 150;

/** Under dette er en utledet hvileforbrenning ikke troverdig. */
export const MIN_PLAUSIBLE_BASAL = 1000;
export const MAX_PLAUSIBLE_BASAL = 3500;

export interface ExpenditureDay {
	/** Withings `totalCalories`: hvile + aktivitet. */
	totalCalories: number | null;
	/** Withings `calories`: bare aktivitet. */
	activityCalories: number | null;
}

/**
 * Hvileforbrenningen, utledet som medianen av `totalCalories − calories`.
 *
 * Medianen, ikke snittet: en enkelt dag med uenige felter — som 3. august — ville
 * ellers dratt tallet ned. Null når ingen dager gir et troverdig svar.
 */
export function deriveBasalMetabolism(days: ExpenditureDay[]): number | null {
	const candidates: number[] = [];
	for (const day of days) {
		if (typeof day.totalCalories !== 'number' || typeof day.activityCalories !== 'number') continue;
		const basal = day.totalCalories - day.activityCalories;
		if (basal >= MIN_PLAUSIBLE_BASAL && basal <= MAX_PLAUSIBLE_BASAL) candidates.push(basal);
	}
	if (candidates.length === 0) return null;

	const sorted = candidates.sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
	return Math.round(median);
}

export interface ExpenditureBreakdown {
	/** Tallet Withings oppgir som total. Det flaten viser. */
	reportedKcal: number;
	/** Utledet hvileforbrenning. Null når vi ikke har grunnlag. */
	basalKcal: number | null;
	/** Aktivitetskalorier fra Withings. */
	activityKcal: number | null;
	/** Hva komponentene summerer til. Null når en av dem mangler. */
	impliedKcal: number | null;
	/** Oppgitt minus implisert. Positivt = totalen er høyere enn delene. */
	discrepancyKcal: number | null;
	/** Sant når delene og totalen er enige innenfor toleransen. */
	reconciles: boolean;
}

export function describeExpenditure(input: {
	reportedKcal: number;
	activityKcal: number | null;
	basalKcal: number | null;
}): ExpenditureBreakdown {
	const { reportedKcal, activityKcal, basalKcal } = input;

	const impliedKcal =
		typeof activityKcal === 'number' && typeof basalKcal === 'number'
			? Math.round(activityKcal + basalKcal)
			: null;
	const discrepancyKcal = impliedKcal === null ? null : Math.round(reportedKcal - impliedKcal);

	return {
		reportedKcal: Math.round(reportedKcal),
		basalKcal,
		activityKcal: activityKcal === null ? null : Math.round(activityKcal),
		impliedKcal,
		discrepancyKcal,
		// Mangler grunnlaget, påstår vi ikke uenighet. Ukjent er ikke det samme som feil.
		reconciles:
			discrepancyKcal === null ? true : Math.abs(discrepancyKcal) <= RECONCILE_TOLERANCE_KCAL
	};
}
