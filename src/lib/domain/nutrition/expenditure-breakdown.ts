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
 * ## Hvilket felt som er til å stole på
 *
 * Målt over fire dager: `totalCalories − basal` treffer `calories`-feltet innenfor
 * 12 kcal på tre av dem. Den fjerde — 3. august — spriker med 654.
 *
 * | Dag | `totalCalories` | minus basal | `calories`-feltet | avvik |
 * |---|---|---|---|---|
 * | 31. juli | 2 430 | 472 | 476 | 5 |
 * | 1. august | 2 699 | 741 | 728 | −12 |
 * | 2. august | 2 276 | 318 | 318 | 0 |
 * | 3. august | 2 763 | **805** | **1 460** | **654** |
 *
 * Og 805 er nettopp hva øktene tilsier: Withings' egne tall for de to
 * el-sykkelturene og yogaen summerer til 698, pluss 2 378 skritt.
 * `calories`-feltet på 1 460 ville krevd 762 kcal fra skritt alene — på dagens
 * laveste skrittall.
 *
 * **`totalCalories` er altså den konsistente kilden, og `calories` er feltet som
 * svikter.** Aktiviteten utledes derfor som `totalCalories − basal`, ikke fra
 * `calories`. Sistnevnte beholdes som kryssjekk: spriker den, er det et
 * datakvalitetssignal om enheten, ikke en grunn til å mistro totalen.
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
	/** Withings' `totalCalories`. Den konsistente kilden — se modulkommentaren. */
	totalKcal: number;
	/** Utledet hvileforbrenning. Null når vi ikke har grunnlag. */
	basalKcal: number | null;
	/** Aktiviteten, utledet som total minus hvile. Null uten hvileforbrenning. */
	activityKcal: number | null;
	/** Withings' eget `calories`-felt, til kryssjekk. */
	reportedActivityKcal: number | null;
	/** Summen av dagens økter, fra Withings' egne tall per økt. */
	workoutKcal: number | null;
	/**
	 * Hvor mye `calories`-feltet avviker fra den utledede aktiviteten. Positivt =
	 * feltet er høyere, altså for høyt.
	 */
	activityFieldDeviationKcal: number | null;
	/** Sant når `calories`-feltet ikke stemmer med resten av dagen. */
	activityFieldSuspect: boolean;
}

export function describeExpenditure(input: {
	totalKcal: number;
	/** Withings' `calories`-felt. Kryssjekk, ikke kilde. */
	reportedActivityKcal: number | null;
	basalKcal: number | null;
	/** Summen av dagens økter, hvis kjent. */
	workoutKcal?: number | null;
}): ExpenditureBreakdown {
	const { totalKcal, reportedActivityKcal, basalKcal } = input;

	const activityKcal = basalKcal === null ? null : Math.round(totalKcal - basalKcal);
	const activityFieldDeviationKcal =
		activityKcal === null || reportedActivityKcal === null
			? null
			: Math.round(reportedActivityKcal - activityKcal);

	return {
		totalKcal: Math.round(totalKcal),
		basalKcal,
		activityKcal,
		reportedActivityKcal:
			reportedActivityKcal === null ? null : Math.round(reportedActivityKcal),
		workoutKcal: input.workoutKcal ?? null,
		activityFieldDeviationKcal,
		// Mangler grunnlaget, påstår vi ingenting. Ukjent er ikke det samme som feil.
		activityFieldSuspect:
			activityFieldDeviationKcal !== null &&
			Math.abs(activityFieldDeviationKcal) > RECONCILE_TOLERANCE_KCAL
	};
}
