/**
 * Klient-trygg normalisering av sportType (ingen server-avhengigheter).
 *
 * Eksterne kilder sender varianter som «eBiking», «E-Bike», «Cycling» — vi
 * lavbokstaverer og mapper e-sykkel-varianter til den kanoniske verdien
 * 'e_bike' som resten av systemet kjenner (autocheck, effort, visning).
 */
export function normalizeSportType(raw: string | null | undefined): string {
	const s = (raw ?? '').trim().toLowerCase();
	if (!s) return s;
	if (s.includes('ebik') || ['e-bike', 'e_bike', 'e_biking', 'elsykkel', 'el-sykkel'].includes(s)) {
		return 'e_bike';
	}
	return s;
}
