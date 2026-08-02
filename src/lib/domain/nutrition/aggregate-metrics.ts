/**
 * Ernæring inn i `sensor_aggregates.metrics.nutrition`.
 *
 * NB: `metrics.calories` finnes allerede og er noe helt annet — forbrente
 * kalorier fra Withings. Inntak ligger under `nutrition` nettopp for å holde de
 * to fra hverandre; å summere dem i samme felt ville gitt et tall uten mening.
 *
 * Ren funksjon slik at regnestykket er testet uten database. Kalles fra
 * `aggregateWeeklyData` og `aggregateMonthlyData`.
 */

import { osloDateKey } from './day-summary';

export interface NutritionAggregate {
	/** Sum for hele perioden. */
	kcalSum: number;
	proteinSum: number;
	carbsSum: number;
	fatSum: number;
	/** Antall dager med minst én registrering. */
	loggedDays: number;
	/** Antall loggede måltid. */
	mealCount: number;
	/**
	 * Snitt per logget dag — ikke per kalenderdag i perioden.
	 *
	 * Med delvis logging ville kalenderdager gitt et kunstig lavt snitt, og et
	 * lavt snitt som skyldes glemt logging er verre enn ingen tall. `loggedDays`
	 * står ved siden av, så flaten kan si hvor mange dager tallet bygger på.
	 */
	kcalPerDay: number;
	proteinPerDay: number;
}

/** Minimumsformen av en sensorhendelse denne funksjonen trenger. */
export interface NutritionEventLike {
	dataType?: string | null;
	timestamp: Date | string;
	data?: Record<string, unknown> | null;
}

function num(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

/**
 * Null når perioden ikke har noen ernæringshendelser.
 *
 * Bevisst null og ikke et nullfylt objekt: kallstedet setter bare
 * `metrics.nutrition` når det finnes noe, på samme måte som `weight` og `sleep`.
 * En periode med `kcalSum: 0` ville sett ut som en dag man ikke spiste.
 */
export function computeNutritionMetrics(events: NutritionEventLike[]): NutritionAggregate | null {
	const meals = events.filter((event) => event.dataType === 'nutrition');
	if (meals.length === 0) return null;

	let kcalSum = 0;
	let proteinSum = 0;
	let carbsSum = 0;
	let fatSum = 0;
	const days = new Set<string>();

	for (const meal of meals) {
		const data = meal.data ?? {};
		kcalSum += num(data.kcal);
		proteinSum += num(data.proteinG);
		carbsSum += num(data.carbsG);
		fatSum += num(data.fatG);
		const key = osloDateKey(meal.timestamp instanceof Date ? meal.timestamp : String(meal.timestamp));
		if (key) days.add(key);
	}

	const loggedDays = days.size;
	// Uten gyldige datoer kan vi ikke regne per dag, men summene er fortsatt gode.
	const divisor = loggedDays > 0 ? loggedDays : 1;

	return {
		kcalSum: Math.round(kcalSum),
		proteinSum: round1(proteinSum),
		carbsSum: round1(carbsSum),
		fatSum: round1(fatSum),
		loggedDays,
		mealCount: meals.length,
		kcalPerDay: Math.round(kcalSum / divisor),
		proteinPerDay: round1(proteinSum / divisor)
	};
}
