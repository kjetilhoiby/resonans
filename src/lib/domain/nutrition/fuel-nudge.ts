/**
 * Nudgen som sier fra før sultkrisa, ikke etterpå.
 *
 * ## Hvorfor
 *
 * Brukeren beskrev tre situasjoner den skal dekke:
 *
 * 1. «Du har spist mindre enn vanlig på denne tiden, tid for en snack?» — med to-tre
 *    forslag fra historikken.
 * 2. «Du har ikke spist lunsj ennå. Hvor sulten føler du deg nå? (1-5)»
 * 3. «Du har løpt 8 km i dag, men bare spist to knekkebrød til lunsj. Ta [en snack]
 *    før middag.»
 *
 * Alle tre er samme innsikt sett fra ulike vinkler: **flaten vet nok til å si det
 * først**. 3. august sto loggen på 304 kcal kl. 15 og brukeren beskrev seg som
 * «veldig sulten i 15-17-tida». Dataen fanget det; ingen sa det.
 *
 * ## Rangeringen
 *
 * Én nudge, aldri tre. Den mest spesifikke vinner, fordi den bærer mest
 * informasjon:
 *
 * 1. **Underernært etter trening** — det er en konkret grunn, ikke bare et avvik.
 * 2. **Bak skjema** — avviket alene.
 * 3. **Måltid hoppet over** — svakest, og derfor formulert som et spørsmål framfor
 *    et råd.
 *
 * ## Hva den ikke gjør
 *
 * Ikke medisinske påstander. Vi sier «få på plass energi», ikke hva som skjer med
 * blodsukkeret — appen måler ikke blodsukker, og et råd som later som den gjør det
 * er verre enn intet råd.
 */

import type { MealSlotId } from './meal-slots';
import type { RepeatableMeal } from './repeat-meals';
import type { IntakePacing } from './intake-pacing';

/** Vinduet nudgen kan sendes i. Utenfor er den påtrengende eller for sent. */
export const EARLIEST_HOUR = 10;
export const LATEST_HOUR = 20;

/** Snacks skal være mellommåltider, ikke et halvt middagsmåltid. */
export const SNACK_MIN_KCAL = 80;
export const SNACK_MAX_KCAL = 600;

/** Under dette har økta ikke kostet nok til å endre rådet. */
export const TRAINING_KCAL_THRESHOLD = 250;

/** Etter denne timen forventer vi at lunsjen er spist. */
export const LUNCH_EXPECTED_BY_HOUR = 13.5;

export type FuelNudgeKind = 'underfuelled-after-training' | 'behind-pacing' | 'missing-meal';

export interface FuelNudgeInput {
	osloHour: number;
	pacing: IntakePacing;
	/** Kcal per måltidsslot i dag. Manglende slot = ikke spist. */
	kcalBySlot: Partial<Record<MealSlotId, number>>;
	/** Dagens økter, til den sterkeste varianten. */
	workouts: Array<{ sportType: string; kcal: number; distanceKm?: number | null }>;
	/** Kandidater til forslag, fra `repeatableMeals`. */
	repeatable: RepeatableMeal[];
	/** Gram protein som mangler mot målet, når det er satt. */
	proteinGapG?: number | null;
}

export interface FuelNudge {
	kind: FuelNudgeKind;
	/** Kort linje, egnet som push-tittel. */
	headline: string;
	/** Utfyllende setning med tallene som begrunner den. */
	body: string;
	/** To-tre forslag fra historikken. Kan være tom. */
	suggestions: RepeatableMeal[];
	/** Sant for varianten som spør framfor å råde. */
	askHunger: boolean;
}

/**
 * Null når det ikke er noe å si — som er det vanlige.
 *
 * En nudge som fyrer hver dag blir bakgrunnsstøy, så portene er strenge: innenfor
 * tidsvinduet, og med et avvik som faktisk er verdt en avbrytelse.
 */
export function decideFuelNudge(input: FuelNudgeInput): FuelNudge | null {
	const { osloHour, pacing } = input;
	if (osloHour < EARLIEST_HOUR || osloHour > LATEST_HOUR) return null;

	const trainingKcal = input.workouts.reduce((sum, w) => sum + (w.kcal || 0), 0);
	const suggestions = pickSuggestions(input.repeatable, input.proteinGapG ?? null);

	// 1. Trent, og spist for lite. Den sterkeste varianten: det finnes en grunn.
	if (trainingKcal >= TRAINING_KCAL_THRESHOLD && pacing.behind) {
		return {
			kind: 'underfuelled-after-training',
			headline: 'Du har trent, men spist lite',
			body: `${describeTraining(input.workouts)} i dag, og loggen står på ${pacing.kcalSoFar} kcal${
				pacing.expectedKcalByNow !== null ? ` mot ${pacing.expectedKcalByNow} normalt nå` : ''
			}. Få på plass noe før middag.`,
			suggestions,
			askHunger: false
		};
	}

	// 2. Bak skjema uten en spesifikk grunn.
	if (pacing.behind) {
		return {
			kind: 'behind-pacing',
			headline: 'Spist mindre enn vanlig — tid for en snack?',
			body:
				pacing.expectedKcalByNow !== null
					? `Du står på ${pacing.kcalSoFar} kcal, mot ${pacing.expectedKcalByNow} du normalt har på denne tiden.`
					: `Du står på ${pacing.kcalSoFar} kcal så langt i dag.`,
			suggestions,
			askHunger: false
		};
	}

	// 3. Lunsjen mangler. Svakest signal, så vi spør framfor å råde.
	const lunchKcal = input.kcalBySlot.lunsj ?? 0;
	if (osloHour >= LUNCH_EXPECTED_BY_HOUR && lunchKcal === 0) {
		return {
			kind: 'missing-meal',
			headline: 'Ingen lunsj logget ennå',
			body: 'Hvor sulten føler du deg nå, på en skala fra 1 til 5?',
			suggestions,
			askHunger: true
		};
	}

	return null;
}

/**
 * To-tre forslag i snack-størrelse fra historikken.
 *
 * Mangler protein, sorteres de proteinrike først — det er den mangelen et
 * mellommåltid faktisk kan tette. Ellers beholdes rekkefølgen fra
 * `repeatableMeals`, altså hyppigst først, siden det som gjentas er det som
 * faktisk blir spist.
 */
export function pickSuggestions(
	repeatable: RepeatableMeal[],
	proteinGapG: number | null
): RepeatableMeal[] {
	const snackSized = repeatable.filter(
		(meal) => meal.macros.kcal >= SNACK_MIN_KCAL && meal.macros.kcal <= SNACK_MAX_KCAL
	);

	const ordered =
		proteinGapG !== null && proteinGapG > 0
			? [...snackSized].sort((a, b) => b.macros.proteinG - a.macros.proteinG)
			: snackSized;

	return ordered.slice(0, 3);
}

/** «Løpt 8,0 km», «To el-sykkelturer», «Trent» — kortest mulig og sant. */
function describeTraining(workouts: FuelNudgeInput['workouts']): string {
	const runs = workouts.filter((w) => w.sportType.toLowerCase().includes('run'));
	const runKm = runs.reduce((sum, w) => sum + (w.distanceKm ?? 0), 0);
	if (runKm >= 1) {
		return `Du har løpt ${runKm.toFixed(1).replace('.', ',')} km`;
	}
	if (workouts.length === 1) return 'Du har trent';
	return `Du har hatt ${workouts.length} økter`;
}
