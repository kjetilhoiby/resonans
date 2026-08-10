/**
 * Vårt eget forbruksestimat, uavhengig av Withings.
 *
 * ## Hvorfor
 *
 * Withings' `calories`-felt krediterte 52 minutter el-sykkel med 1 460 kcal — 28 per
 * minutt, elitenivå — fordi enheten klassifiserte turen som «Cycling» og ikke hadde
 * puls å regne fra. Vi kan ikke rette enheten, men vi kan regne selv og se om
 * tallene er i nærheten av hverandre.
 *
 * Dette er ikke en mer nøyaktig sannhet. Det er en **andre mening** med kjente
 * forutsetninger, som er noe helt annet enn et tall fra en svart boks.
 *
 * ## Hvordan
 *
 * 1. **Hvileforbrenning** fra Mifflin-St Jeor, som er standarden og treffer bedre
 *    enn Harris-Benedict på moderne populasjoner. Krever vekt, høyde, alder og
 *    kjønn — mangler noe, returnerer vi null framfor å gjette.
 * 2. **Daglig grunnforbruk** = hvile × en lav aktivitetsfaktor for kontorjobb. Lav
 *    med vilje: øktene legges til separat, og en høyere faktor ville tatt dem med
 *    to ganger.
 * 3. **Øktene** fra MET-verdier, med **(MET − 1)**. Det siste er detaljen som
 *    oftest glemmes: en MET-tabell gir *brutto* forbruk, som inkluderer
 *    hvilestoffskiftet i de samme minuttene. Legger man brutto oppå et
 *    døgnforbruk som alt dekker hvile, teller man hvilen dobbelt — omtrent 60 kcal
 *    på en times økt.
 */

export type Sex = 'male' | 'female';

export interface BodyProfile {
	weightKg: number;
	heightCm: number;
	ageYears: number;
	sex: Sex;
}

/**
 * Aktivitetsfaktoren for en stillesittende hverdag.
 *
 * Standardtabeller setter «sedentary» til 1,2 og «lett aktiv» til 1,375, men de
 * faktorene er ment å dekke *all* aktivitet inkludert trening. Siden vi legger
 * øktene på toppen, brukes den laveste — den skal dekke søvn, kontorstol,
 * husarbeid og pendling, ikke trening.
 */
export const DESK_JOB_FACTOR = 1.25;

/**
 * MET-verdier, fra Compendium of Physical Activities der de finnes.
 *
 * **El-sykkel er den viktige.** Vanlig sykling i moderat tempo ligger på 6–8 MET,
 * men med pedalassistanse faller arbeidet kraftig: studier plasserer el-sykling
 * rundt 4–5. Withings ser ikke forskjellen — turene logges som «Cycling» — og det
 * er der avviket vårt oppstår.
 *
 * Løping håndteres ikke her, men av `runningMet`, fordi den skalerer med farten.
 */
export const MET_VALUES: Record<string, number> = {
	e_bike: 4.5,
	ebike: 4.5,
	cycling: 7,
	walking: 3.5,
	hiking: 6,
	swimming: 7,
	strength: 4.5,
	lift_weights: 4.5,
	yoga: 2.5,
	football: 7,
	rowing: 7,
	elliptical: 5,
	skiing: 7
};

/** Når vi ikke kjenner idretten. Bevisst lavt — heller under enn over. */
export const UNKNOWN_MET = 4;

/**
 * Løpe-MET fra farten, etter ACSM: VO2 = 0,2 · m/min + 3,5 (flatt).
 *
 * En fast verdi for «running» ville vært feil i begge retninger — 8 km/h og
 * 14 km/h skiller nesten 5 MET.
 */
export function runningMet(speedKmH: number): number {
	if (!Number.isFinite(speedKmH) || speedKmH <= 0) return UNKNOWN_MET;
	const metersPerMinute = (speedKmH * 1000) / 60;
	const vo2 = 0.2 * metersPerMinute + 3.5;
	return Math.max(2, vo2 / 3.5);
}

/**
 * Hvileforbrenning (BMR) etter Mifflin-St Jeor.
 *
 * Null når profilen er ufullstendig eller urimelig. Vi gjetter ikke på høyde eller
 * alder — et forbrukstall bygget på en antatt kroppshøyde er verre enn ingen tall,
 * fordi det ser like troverdig ut.
 */
export function basalMetabolicRate(profile: Partial<BodyProfile>): number | null {
	const { weightKg, heightCm, ageYears, sex } = profile;
	if (typeof weightKg !== 'number' || weightKg < 30 || weightKg > 300) return null;
	if (typeof heightCm !== 'number' || heightCm < 120 || heightCm > 230) return null;
	if (typeof ageYears !== 'number' || ageYears < 10 || ageYears > 110) return null;
	if (sex !== 'male' && sex !== 'female') return null;

	const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
	return Math.round(sex === 'male' ? base + 5 : base - 161);
}

export interface WorkoutForEstimate {
	/** `sportType` fra canonical_workouts. */
	sportType: string | null;
	durationSeconds: number | null;
	/** Brukes bare for løping, til å utlede farten. */
	distanceMeters?: number | null;
}

export interface WorkoutEstimate {
	sportType: string;
	minutes: number;
	met: number;
	/** Netto kcal — hvilestoffskiftet i de samme minuttene er trukket fra. */
	kcal: number;
}

/**
 * Netto kalorier for én økt.
 *
 * `(MET − 1)` framfor `MET`: se modulkommentaren. Null når varigheten mangler.
 */
export function estimateWorkoutKcal(
	workout: WorkoutForEstimate,
	weightKg: number
): WorkoutEstimate | null {
	const seconds = workout.durationSeconds;
	if (typeof seconds !== 'number' || seconds <= 0) return null;
	if (!Number.isFinite(weightKg) || weightKg <= 0) return null;

	const minutes = seconds / 60;
	const sportType = (workout.sportType ?? 'ukjent').toLowerCase();

	let met: number;
	if (sportType.includes('run')) {
		const meters = workout.distanceMeters;
		met =
			typeof meters === 'number' && meters > 0
				? runningMet(meters / 1000 / (seconds / 3600))
				: UNKNOWN_MET;
	} else {
		met = MET_VALUES[sportType] ?? UNKNOWN_MET;
	}

	// 3,5 ml O2/kg/min per MET, og 5 kcal per liter O2 → MET · 3,5 · kg / 200.
	const kcalPerMinute = ((met - 1) * 3.5 * weightKg) / 200;
	return {
		sportType,
		minutes: Math.round(minutes),
		met: Math.round(met * 10) / 10,
		kcal: Math.round(kcalPerMinute * minutes)
	};
}

export interface DailyExpenditureEstimate {
	basalKcal: number;
	/** Hvile × kontorjobbfaktor. Dekker alt utenom øktene. */
	baselineKcal: number;
	workoutKcal: number;
	totalKcal: number;
	workouts: WorkoutEstimate[];
}

/**
 * Vårt eget døgnestimat: kontorhverdag pluss de øktene som faktisk er logget.
 *
 * Null når profilen ikke holder. Merk at inkrementell bevegelse utover det
 * faktoren dekker — en dag med 15 000 skritt uten registrert økt — ikke legges til.
 * Det gjør estimatet konservativt, og det er den retningen å ta feil i.
 */
export function estimateDailyExpenditure(input: {
	profile: Partial<BodyProfile>;
	workouts: WorkoutForEstimate[];
	deskJobFactor?: number;
}): DailyExpenditureEstimate | null {
	const basalKcal = basalMetabolicRate(input.profile);
	if (basalKcal === null) return null;

	const weightKg = input.profile.weightKg as number;
	const factor = input.deskJobFactor ?? DESK_JOB_FACTOR;
	const baselineKcal = Math.round(basalKcal * factor);

	const workouts = input.workouts
		.map((workout) => estimateWorkoutKcal(workout, weightKg))
		.filter((estimate): estimate is WorkoutEstimate => estimate !== null);
	const workoutKcal = workouts.reduce((sum, w) => sum + w.kcal, 0);

	return {
		basalKcal,
		baselineKcal,
		workoutKcal,
		totalKcal: baselineKcal + workoutKcal,
		workouts
	};
}
