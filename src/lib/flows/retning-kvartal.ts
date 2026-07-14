/**
 * Retningssamtalen — kvartalsvis konfrontasjon mellom uttalt retning og
 * faktisk hverdag. Rene hjelpere: kvartalsnøkkel, chip-vindu og parsing av
 * <visjon>-blokken fra samtalens siste melding.
 */

/** Kvartalsnøkkel for en dato, f.eks. '2026-Q3'. */
export function quarterPeriodKey(date: Date): string {
	const quarter = Math.floor(date.getMonth() / 3) + 1;
	return `${date.getFullYear()}-Q${quarter}`;
}

/** Antall dager inn i inneværende kvartal (1 = første dag). */
export function daysIntoQuarter(date: Date): number {
	const quarterStartMonth = Math.floor(date.getMonth() / 3) * 3;
	const quarterStart = new Date(date.getFullYear(), quarterStartMonth, 1);
	return Math.floor((date.getTime() - quarterStart.getTime()) / 86_400_000) + 1;
}

/** Chip-vindu: de første ~3 ukene av hvert kvartal. */
export function isInQuarterWindow(date: Date, windowDays = 21): boolean {
	return daysIntoQuarter(date) <= windowDays;
}

/**
 * Hent revidert kvartalsvisjon fra samtalens siste melding — innholdet mellom
 * <visjon>-markørene. Tom streng uten markører (bevisst strengt, så vi aldri
 * lagrer løs prosa som visjon).
 */
export function parseVisionBlock(message: string): string {
	const match = message.match(/<visjon>([\s\S]*?)<\/visjon>/i);
	return match ? match[1].trim() : '';
}
