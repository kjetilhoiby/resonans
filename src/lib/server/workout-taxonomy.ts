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
 * kjenner (autocheck, effort, taxonomy, analyse). Eksterne apper (f.eks. Ekko)
 * kan sende varianter som «eBiking», «E-Bike», «Cycling» — vi lavbokstaverer og
 * mapper e-sykkel-varianter til 'e_bike'. Trygt å kjøre på alle kilder.
 */
export function normalizeSportType(raw: string | null | undefined): string {
	const s = (raw ?? '').trim().toLowerCase();
	if (!s) return s;
	if (s.includes('ebik') || ['e-bike', 'e_bike', 'e_biking', 'elsykkel', 'el-sykkel'].includes(s)) {
		return 'e_bike';
	}
	return s;
}

export function describeWorkoutSportType(sportType: string): string {
	const normalized = sportType.trim().toLowerCase();
	return WORKOUT_TITLE_BY_SPORT[normalized] ?? 'Treningsøkt';
}

export function getSensorGoalMetricTypesForSportType(sportType: string): string[] {
	return SENSOR_GOAL_METRICS_BY_SPORT[sportType.toLowerCase()] ?? [];
}
