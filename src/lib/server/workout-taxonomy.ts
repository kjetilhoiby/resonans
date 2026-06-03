const WORKOUT_TITLE_BY_SPORT: Record<string, string> = {
	running: 'Løpetur',
	indoor_running: 'Løpetur',
	cycling: 'Sykkeløkt',
	e_bike: 'Sykkeløkt',
	indoor_cycling: 'Sykkeløkt',
	swimming: 'Svømmeøkt',
	walking: 'Gåtur',
	indoor_walking: 'Gåtur'
};

const SENSOR_GOAL_METRICS_BY_SPORT: Record<string, string[]> = {
	running: ['workouts', 'runs', 'running'],
	cycling: ['workouts', 'cycling'],
	e_bike: ['workouts', 'cycling'],
	swimming: ['workouts', 'swimming'],
	walking: ['workouts', 'walking'],
	hiking: ['workouts', 'hiking'],
	trail: ['workouts', 'trail_running', 'hiking'],
	tennis: ['workouts', 'tennis'],
	volleyball: ['workouts', 'volleyball'],
	badminton: ['workouts', 'badminton'],
	basketball: ['workouts', 'basketball']
};

/**
 * Normaliserer en innkommende sportType til en kanonisk verdi resten av systemet
 * kjenner (autocheck, effort, taxonomy, analyse). Definisjonen ligger klient-trygt
 * i $lib/utils/sport og re-eksporteres her for server-bruk.
 */
export { normalizeSportType } from '$lib/utils/sport';

export function describeWorkoutSportType(sportType: string): string {
	const normalized = sportType.trim().toLowerCase();
	return WORKOUT_TITLE_BY_SPORT[normalized] ?? 'Treningsøkt';
}

export function getSensorGoalMetricTypesForSportType(sportType: string): string[] {
	return SENSOR_GOAL_METRICS_BY_SPORT[sportType.toLowerCase()] ?? [];
}
