/**
 * Timevindu-beregning for skjermtid-widgets.
 *
 * Skjermtid-events (data_type 'screen_time') lagrer valgfritt `hourly`-buckets
 * med minutter per klokketime (lokal tid). Funksjonene her summerer minutter
 * innenfor et vindu [hourFrom, hourTo) slik at widgets kan vise f.eks.
 * «Skjermtid kl. 16–19».
 */

export interface HourBucket {
	hour: number; // 0..23 (lokal tid)
	totalMinutes: number;
}

export interface HourWindow {
	from: number; // inklusiv, 0–23
	to: number;   // eksklusiv, 1–24
}

/**
 * Validerer et timevindu-par fra widget-konfig.
 * Gyldig: from er heltall 0–23, to er heltall 1–24, from ≠ to (og from ≠ to − 24).
 * Returnerer null når vinduet mangler eller er ugyldig → hele døgnet.
 */
export function normalizeHourWindow(
	hourFrom: number | null | undefined,
	hourTo: number | null | undefined
): HourWindow | null {
	if (hourFrom == null || hourTo == null) return null;
	if (!Number.isInteger(hourFrom) || !Number.isInteger(hourTo)) return null;
	if (hourFrom < 0 || hourFrom > 23) return null;
	if (hourTo < 1 || hourTo > 24) return null;
	// from === to gir et tomt vindu → tolkes som «ikke satt»
	if (hourFrom === hourTo) return null;
	return { from: hourFrom, to: hourTo };
}

/**
 * Summerer minutter i vinduet [from, to). Vindu som krysser midnatt (from > to,
 * f.eks. 22→6) teller timene ≥ from pluss timene < to innenfor samme døgn.
 *
 * Returnerer null når hourly-data mangler eller er tom — dager uten
 * timesoppløsning skal ikke telle som 0 i snittberegninger.
 */
export function minutesInWindow(
	hourly: HourBucket[] | null | undefined,
	window: HourWindow
): number | null {
	if (!Array.isArray(hourly) || hourly.length === 0) return null;

	let sum = 0;
	let sawValidBucket = false;
	for (const bucket of hourly) {
		if (!bucket || !Number.isInteger(bucket.hour) || bucket.hour < 0 || bucket.hour > 23) continue;
		const minutes = Number(bucket.totalMinutes);
		if (!Number.isFinite(minutes)) continue;
		sawValidBucket = true;

		const inWindow = window.from < window.to
			? bucket.hour >= window.from && bucket.hour < window.to
			: bucket.hour >= window.from || bucket.hour < window.to;
		if (inWindow) sum += minutes;
	}

	return sawValidBucket ? sum : null;
}
