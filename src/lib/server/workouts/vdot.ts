/**
 * VDOT-estimering og avledede treningspaces, basert på Jack Daniels'
 * Running Formula. Tabellene er fritt publisert; vi implementerer dem
 * direkte fra formelen.
 *
 * VDOT = VO2max-ekvivalent. Lar oss konvertere én konkurransetid til
 *   - estimater for andre distanser (Riegel-aktig)
 *   - anbefalte treningstempo (easy / marathon / threshold / interval)
 *
 * Bruksmønster: ta beste 5k eller 10k tid → vdotFromTime → daniels-paces.
 */

export interface DanielsPaces {
	easySecPerKm: number;
	marathonSecPerKm: number;
	tempoSecPerKm: number; // threshold
	intervalSecPerKm: number;
}

/**
 * Daniels' formel for VDOT fra en gitt tid:
 *
 *   velocity (m/min) = distance_m / (time_s / 60)
 *   vo2_used         = -4.6 + 0.182258 * v + 0.000104 * v^2
 *   vo2max_fraction  = 0.8 + 0.1894393 * exp(-0.012778 * tMin) + 0.2989558 * exp(-0.1932605 * tMin)
 *   VDOT             = vo2_used / vo2max_fraction
 */
export function vdotFromTime(distanceMeters: number, timeSeconds: number): number | null {
	if (distanceMeters <= 0 || timeSeconds <= 0) return null;
	if (distanceMeters < 1500) return null; // for korte distanser blir tallet ustabilt
	const tMin = timeSeconds / 60;
	const v = distanceMeters / tMin; // m/min
	const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
	const fraction =
		0.8 +
		0.1894393 * Math.exp(-0.012778 * tMin) +
		0.2989558 * Math.exp(-0.1932605 * tMin);
	if (fraction <= 0) return null;
	const vdot = vo2 / fraction;
	if (!Number.isFinite(vdot)) return null;
	return Math.round(vdot * 10) / 10;
}

/**
 * Inverse: gitt VDOT og prosent av VO2max, returnerer pace i sek/km.
 *  - Easy:     59-74% VO2max  → bruk 70% som typisk easy
 *  - Marathon: 75-84% VO2max  → bruk 82%
 *  - Tempo:    83-88% VO2max  → bruk 88% (threshold)
 *  - Interval: 95-100% VO2max → bruk 98%
 */
function paceForFraction(vdot: number, vo2Fraction: number): number {
	// vo2_used = -4.6 + 0.182258 * v + 0.000104 * v^2
	// vo2_used = vdot * vo2Fraction  (omtrentlig — Daniels gjør faktisk noe litt mer komplekst,
	// men dette er godt nok som anbefalt-pace innenfor ±2-3 sek/km av offisielle tabeller)
	const vo2 = vdot * vo2Fraction;
	// Løs andregrad: 0.000104 * v^2 + 0.182258 * v - (4.6 + vo2) = 0
	const a = 0.000104;
	const b = 0.182258;
	const c = -(4.6 + vo2);
	const disc = b * b - 4 * a * c;
	if (disc < 0) return Infinity;
	const v = (-b + Math.sqrt(disc)) / (2 * a); // m/min
	if (v <= 0) return Infinity;
	const secPerKm = (1000 / v) * 60;
	return Math.round(secPerKm);
}

export function paceZonesForVdot(vdot: number): DanielsPaces {
	return {
		easySecPerKm: paceForFraction(vdot, 0.7),
		marathonSecPerKm: paceForFraction(vdot, 0.82),
		tempoSecPerKm: paceForFraction(vdot, 0.88),
		intervalSecPerKm: paceForFraction(vdot, 0.98)
	};
}

/**
 * Velg beste VDOT-estimat på tvers av tilgjengelige PR-er. Lengre distanser
 * gir mer pålitelig estimat (mindre påvirket av sprintkapasitet), så vi
 * foretrekker 10k > 5k > 3k.
 */
export function estimateVdotFromBestEfforts(efforts: {
	'1k'?: number;
	'3k'?: number;
	'5k'?: number;
	'10k'?: number;
}): { vdot: number; sourceDistance: '3k' | '5k' | '10k' } | null {
	if (typeof efforts['10k'] === 'number') {
		const v = vdotFromTime(10000, efforts['10k']);
		if (v != null) return { vdot: v, sourceDistance: '10k' };
	}
	if (typeof efforts['5k'] === 'number') {
		const v = vdotFromTime(5000, efforts['5k']);
		if (v != null) return { vdot: v, sourceDistance: '5k' };
	}
	if (typeof efforts['3k'] === 'number') {
		const v = vdotFromTime(3000, efforts['3k']);
		if (v != null) return { vdot: v, sourceDistance: '3k' };
	}
	return null;
}

/**
 * Estimer VDOT fra et jevnt løp via pace + puls-respons:
 * pace gir VO2-forbruket (Daniels-formelen), og snittpuls som andel av
 * heart rate reserve (Karvonen) approksimerer %VO2max. VDOT = vo2 / andel.
 *
 * Løper du samme pace på lavere puls enn før, gir dette høyere VDOT —
 * altså fanger den formforbedring uten at det trengs en test.
 * Mest pålitelig for jevne rolige løp; guards avviser ekstreme verdier.
 */
export function vdotFromPaceAndHr(
	paceSecPerKm: number,
	avgHr: number,
	restHr: number,
	maxHr: number
): number | null {
	if (paceSecPerKm < 150 || paceSecPerKm > 720) return null;
	if (!(maxHr > restHr) || avgHr <= restHr) return null;
	const fraction = (avgHr - restHr) / (maxHr - restHr);
	if (fraction < 0.45 || fraction > 1.05) return null;
	const v = 60000 / paceSecPerKm; // m/min
	const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
	if (vo2 <= 0) return null;
	const vdot = vo2 / fraction;
	if (!Number.isFinite(vdot) || vdot < 20 || vdot > 85) return null;
	return Math.round(vdot * 10) / 10;
}

/**
 * Cooper 12-min test → VDOT.
 * Cooper-test måler hvor langt du kommer på 12 min av jevn maksimal innsats.
 * Distanse i meter brukes med Daniels-formelen for tMin=12.
 */
export function vdotFromCooper(meters: number): number | null {
	if (meters <= 0) return null;
	return vdotFromTime(meters, 12 * 60);
}
