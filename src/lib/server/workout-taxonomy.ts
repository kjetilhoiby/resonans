const WORKOUT_TITLE_BY_SPORT: Record<string, string> = {
	running: 'Løpetur',
	indoor_running: 'Løpetur',
	cycling: 'Sykkeløkt',
	indoor_cycling: 'Sykkeløkt',
	swimming: 'Svømmeøkt',
	walking: 'Gåtur',
	indoor_walking: 'Gåtur'
};

const SENSOR_GOAL_METRICS_BY_SPORT: Record<string, string[]> = {
	running: ['workouts', 'runs', 'running'],
	cycling: ['workouts', 'cycling'],
	swimming: ['workouts', 'swimming'],
	walking: ['workouts', 'walking'],
	hiking: ['workouts', 'hiking'],
	trail: ['workouts', 'trail_running', 'hiking'],
	tennis: ['workouts', 'tennis'],
	volleyball: ['workouts', 'volleyball'],
	badminton: ['workouts', 'badminton'],
	basketball: ['workouts', 'basketball']
};

export function describeWorkoutSportType(sportType: string): string {
	const normalized = sportType.trim().toLowerCase();
	return WORKOUT_TITLE_BY_SPORT[normalized] ?? 'Treningsøkt';
}

export function getSensorGoalMetricTypesForSportType(sportType: string): string[] {
	return SENSOR_GOAL_METRICS_BY_SPORT[sportType.toLowerCase()] ?? [];
}
