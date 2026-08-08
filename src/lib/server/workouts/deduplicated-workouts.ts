import { buildUnifiedWorkoutActivities } from '$lib/server/activity-layer';
import { workoutSportFamily } from '$lib/domain/health/workout-sport';

/**
 * Én reell treningsøkt — kildene er allerede slått sammen.
 *
 * Samme løpetur skrives av opptil tre sensorer (Withings-klokka, GPX-fila fra
 * Dropbox og Ekko-opplastingen), med startpunkter som spriker noen minutter.
 * `buildUnifiedWorkoutActivities` klynger dem innenfor to timer per
 * sportsfamilie og velger distansen fra kilden med høyest prioritet — alt som
 * teller kilometer skal lese gjennom den, aldri summere `sensor_events`
 * direkte.
 */
export type DeduplicatedWorkout = {
	timestamp: Date;
	sportType: string;
	sportFamily: string;
	distanceMeters: number | null;
	durationSeconds: number | null;
};

/**
 * Deduplikerte økter i et tidsrom, nyeste sist.
 *
 * Leser live fra activity-laget framfor `canonical_workouts`: projeksjonen
 * dekker bare de periodene en jobb har bygd, og en widget som viser halve
 * sannheten er verre enn en som er treg. Tallene blir de samme — projeksjonen
 * bygges av nøyaktig denne funksjonen.
 */
export async function readDeduplicatedWorkouts(
	userId: string,
	from: Date,
	to: Date,
	limit = 2000
): Promise<DeduplicatedWorkout[]> {
	const unified = await buildUnifiedWorkoutActivities(userId, { since: from, limit });

	// Taket ligger på RÅ events, som hentes eldst-først — treffer vi det, er det de
	// nyeste øktene som mangler, og et for lavt tall ser ut som en dårlig periode.
	if (unified.length >= limit) {
		console.warn(
			`[deduplicated-workouts] traff taket på ${limit} events for ${userId} (${from.toISOString()}–${to.toISOString()}) — nyere økter kan mangle`
		);
	}

	return unified
		.map((workout) => ({
			timestamp: new Date(workout.startTime),
			sportType: workout.sportType,
			sportFamily: workoutSportFamily(workout.sportType),
			distanceMeters: workout.distanceMeters,
			durationSeconds: workout.durationSeconds
		}))
		.filter((workout) => workout.timestamp >= from && workout.timestamp <= to)
		.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}
