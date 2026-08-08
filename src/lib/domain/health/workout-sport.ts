/**
 * Sportsfamilier for treningsøkter.
 *
 * Kildene skriver ulike navn på samme aktivitet — Withings sender `running`,
 * en GPX kan si `trail_running`, en manuell logg `løp`. Familien er det nivået
 * flatene teller på («løpedistanse»), og den må være ETT sted: fram til august
 * 2026 fantes mappingen i tre kopier (activity-layer, workout-projection-service
 * og et rått `data->>'sportType' = 'running'` i widget-endepunktet), og
 * widget-tallet inkluderte derfor verken `trail_running` eller `indoor_running`.
 */

/** Kanonisk familie for en sportType. Ukjente typer er sin egen familie. */
export function workoutSportFamily(sportType: string | null | undefined): string {
	const value = (sportType ?? '').trim().toLowerCase();
	if (value.includes('running') || value === 'løp' || value === 'run') return 'running';
	if (value.includes('cycling') || value === 'e_bike' || value.includes('ebik')) return 'cycling';
	if (value.includes('walking') || value === 'hiking') return 'walking';
	if (value.includes('swimming')) return 'swimming';
	return value || 'workout';
}

/**
 * Matcher en økt mot et sportsfilter (widgetens `filterSubcategory`).
 *
 * Filteret treffer enten en eksakt sportType eller en hel familie — `running`
 * tar med `trail_running`, mens `e_bike` bare tar e-sykkel og ikke all sykling.
 * Tomt filter betyr «alle økter».
 */
export function matchesWorkoutSportFilter(
	sportType: string | null | undefined,
	filter: string | null | undefined
): boolean {
	const wanted = (filter ?? '').trim().toLowerCase();
	if (!wanted) return true;

	const sport = (sportType ?? '').trim().toLowerCase();
	if (sport === wanted) return true;

	return workoutSportFamily(sport) === wanted;
}
