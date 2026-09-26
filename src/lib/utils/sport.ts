/**
 * Klient-trygg normalisering av sportType (ingen server-avhengigheter).
 *
 * Eksterne kilder sender varianter som «eBiking», «E-Bike», «Cycling» — vi
 * lavbokstaverer og mapper e-sykkel-varianter til den kanoniske verdien
 * 'e_bike' som resten av systemet kjenner (autocheck, effort, visning).
 *
 * Ekko sender `treadmill` for mølleøkter. Den kanoniske verdien er
 * `indoor_running`, som alt er i løpefamilien (`workoutSportFamily`), har tittel
 * og Strava-type — `treadmill` hadde ingen av delene og ble sin egen familie,
 * så en mølletur telte ikke som løping.
 */
export function normalizeSportType(raw: string | null | undefined): string {
	const s = (raw ?? '').trim().toLowerCase();
	if (!s) return s;
	if (s.includes('ebik') || ['e-bike', 'e_bike', 'e_biking', 'elsykkel', 'el-sykkel'].includes(s)) {
		return 'e_bike';
	}
	if (['treadmill', 'tredemølle', 'mølle'].includes(s)) return 'indoor_running';
	return s;
}
