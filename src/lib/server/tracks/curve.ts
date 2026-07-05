/**
 * Felles progresjonskurve: lineær interpolasjon fra baseline til mål over
 * løpets varighet. Alle motorer bruker denne som "forventet nivå i dag".
 */

const DAY_MS = 24 * 3600_000;

export function daysBetween(fromIso: string, toIso: string): number {
	const from = Date.parse(`${fromIso}T00:00:00Z`);
	const to = Date.parse(`${toIso}T00:00:00Z`);
	return Math.round((to - from) / DAY_MS);
}

/** Andel av løpet som er gått på gitt dato, klampet til [0, 1]. */
export function progressFraction(startDate: string, targetDate: string, date: string): number {
	const total = daysBetween(startDate, targetDate);
	if (total <= 0) return 1;
	const elapsed = daysBetween(startDate, date);
	return Math.max(0, Math.min(1, elapsed / total));
}

export function expectedAt(
	fra: number,
	til: number,
	startDate: string,
	targetDate: string,
	date: string
): number {
	return fra + (til - fra) * progressFraction(startDate, targetDate, date);
}

/** 1-basert ukenummer i løpet for gitt dato (uke 1 = startuken). */
export function weekNumberAt(startDate: string, date: string): number {
	return Math.max(1, Math.floor(daysBetween(startDate, date) / 7) + 1);
}

/** ISO-ukedag 1=man..7=søn for en YYYY-MM-DD-dato. */
export function isoWeekday(date: string): number {
	const day = new Date(`${date}T00:00:00Z`).getUTCDay();
	return day === 0 ? 7 : day;
}

/** Mandag i samme ISO-uke som dato (YYYY-MM-DD). */
export function mondayOfDate(date: string): string {
	const d = new Date(`${date}T00:00:00Z`);
	const weekday = isoWeekday(date);
	d.setUTCDate(d.getUTCDate() - (weekday - 1));
	return d.toISOString().slice(0, 10);
}
