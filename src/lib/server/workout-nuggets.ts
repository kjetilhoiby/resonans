/**
 * Krydderet på en økt — datainnhentingen. Reglene bor rent i
 * `$lib/domain/health/workout-nugget-rules.ts`.
 *
 * Se `docs/changelog/2026-08-10-krydder-per-aktivitet.md`.
 *
 * **Historikken leses deduplisert.** Fram til august 2026 gikk denne modulen
 * rett på `sensor_events`, og siden samme løpetur skrives av opptil tre sensorer
 * (klokka, GPX-fila fra Dropbox og Ekko-opplastingen) telte den én tur som tre.
 * «3. økt denne uka!» kunne være én tur beskrevet av tre kilder, og
 * `MIN_SAMPLES_FOR_BUCKET_PR` var i praksis oppfylt av en enkelt økt.
 */

import { buildUnifiedWorkoutActivities } from '$lib/server/activity-layer';
import { pickNugget, type NuggetWorkout } from '$lib/domain/health/workout-nugget-rules';
import type { WorkoutContextSummary } from '$lib/server/workout-context';

export interface WorkoutNugget {
	headline: string;
}

/** Hvor langt tilbake vi leter etter rekorder og streaks. */
const HISTORY_DAYS = 400;

/**
 * Taket i aktivitetslaget. Historikken hentes eldst-først, så treffer vi taket
 * er det de nyeste øktene som mangler — og et for lavt tall ville gjort en
 * gammel tur til «lengste noensinne».
 */
const MAX_HISTORY_ROWS = 4000;

export async function computeWorkoutNugget(
	userId: string,
	workout: WorkoutContextSummary
): Promise<WorkoutNugget | null> {
	const workoutDate = new Date(workout.timestamp);
	const since = new Date(workoutDate.getTime() - HISTORY_DAYS * 24 * 60 * 60 * 1000);

	const unified = await buildUnifiedWorkoutActivities(userId, { since, limit: MAX_HISTORY_ROWS });

	// Klynga som inneholder DENNE hendelsen er ikke historikk. Vi kjenner den
	// igjen på evidence-ideene, ikke på klyngens id: `activityId` er klyngens
	// eldste kilde, og den er ikke nødvendigvis raden vi ble kalt med.
	const history: NuggetWorkout[] = unified
		.filter((activity) => !activity.evidence.some((e) => e.eventId === workout.id))
		.map((activity) => ({
			timestamp: new Date(activity.startTime),
			sportType: activity.sportType,
			distanceMeters: activity.distanceMeters,
			durationSeconds: activity.durationSeconds
		}));

	const current: NuggetWorkout = {
		timestamp: workoutDate,
		sportType: workout.sportType,
		distanceMeters: workout.distanceMeters,
		durationSeconds: workout.durationSeconds,
		elevationMeters: workout.elevationMeters
	};

	const headline = pickNugget(current, history);
	return headline ? { headline } : null;
}
