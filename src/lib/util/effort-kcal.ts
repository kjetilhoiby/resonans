/**
 * Effort ↔ kcal-broen: tommelfingerregler for hva effort-poeng betyr i
 * energiforbruk og vekt.
 *
 * Utledning: effort (uten puls) = minutter × familiefaktor × 2.5, der
 * faktorene (running 1.0, cycling 0.85, ebike 0.4, …) er proporsjonale med
 * reelle MET-verdier med forhold MET/faktor ≈ 9.5 på tvers av familiene.
 * Reelt forbruk: kcal/min = MET × 3.5 × kg / 200 = MET × 0.0175 × kg.
 * Dermed: kcal per effort-poeng ≈ (0.0175 × 9.5 / 2.5) × kg ≈ 0.066 × kg.
 *
 * Dette er tommelfingerregler (±20–30 %) — poenget er størrelsesorden og
 * sammenlignbarhet, ikke presisjon.
 */

export const KCAL_PER_EFFORT_PER_KG = 0.066;
export const KCAL_PER_KG_FAT = 7700;
const KCAL_PER_MET_MIN_PER_KG = 0.0175;
const MET_CALIBRATION = 2.5;

// Antatte reelle MET-verdier for eksemplene (Compendium of Physical Activities, ca.)
const MET_FOTBALL = 8.0;
const MET_SYKKEL = 7.5;
const MET_ELSYKKEL = 4.5;
const MET_ROLIG_LOP = 9.5;

// Effort-familiefaktorer (speiler MET_FACTOR_BY_FAMILY i effort-service)
const FAKTOR_OTHER = 0.5; // fotball klassifiseres som 'other'
const FAKTOR_SYKKEL = 0.85;
const FAKTOR_ELSYKKEL = 0.4;

export function kcalPerEffortPoint(weightKg: number): number {
	return Math.round(KCAL_PER_EFFORT_PER_KG * weightKg * 100) / 100;
}

export function effortToKcal(effort: number, weightKg: number): number {
	return Math.round(effort * KCAL_PER_EFFORT_PER_KG * weightKg);
}

/** Ukentlig kcal-mengde → kg fettmasse per uke. */
export function weeklyKcalToKg(kcalPerWeek: number): number {
	return Math.round((kcalPerWeek / KCAL_PER_KG_FAT) * 100) / 100;
}

export interface EffortSwapExample {
	label: string;
	/** Effort-poeng slik økten registreres i systemet. */
	effortPoints: number;
	/** Reelt energiforbruk (tommelfingerregel). */
	kcalPerWeek: number;
	weeklyKg: number;
}

function example(label: string, effortPoints: number, kcalPerWeek: number): EffortSwapExample {
	return {
		label,
		effortPoints: Math.round(effortPoints),
		kcalPerWeek: Math.round(kcalPerWeek),
		weeklyKg: weeklyKcalToKg(kcalPerWeek)
	};
}

/**
 * Konkrete «hva gir hva»-eksempler tilpasset brukerens vekt og pace.
 * Effort-poengene bruker systemets egen skåring (så tallene matcher
 * budsjettet); kcal bruker reelle MET-verdier.
 */
export function buildSwapExamples(weightKg: number, paceSekPerKm: number): EffortSwapExample[] {
	const kcalPerMetMin = KCAL_PER_MET_MIN_PER_KG * weightKg;

	// 2 × 30 min fotball
	const fotballMin = 60;
	const fotball = example(
		'2 × 30 min fotball',
		fotballMin * FAKTOR_OTHER * MET_CALIBRATION,
		fotballMin * MET_FOTBALL * kcalPerMetMin
	);

	// Bytte el-sykkel → manuell sykkel 2 × 40 min (differansen)
	const sykkelMin = 80;
	const sykkelbytte = example(
		'El-sykkel → manuell sykkel, 2 × 40 min',
		sykkelMin * (FAKTOR_SYKKEL - FAKTOR_ELSYKKEL) * MET_CALIBRATION,
		sykkelMin * (MET_SYKKEL - MET_ELSYKKEL) * kcalPerMetMin
	);

	// Én ekstra rolig 5 km-løpetur
	const lopMin = (5 * paceSekPerKm) / 60;
	const lopetur = example(
		'Én ekstra rolig 5 km',
		lopMin * 1.0 * MET_CALIBRATION,
		lopMin * MET_ROLIG_LOP * kcalPerMetMin
	);

	return [fotball, sykkelbytte, lopetur];
}
