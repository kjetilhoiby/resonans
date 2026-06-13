/**
 * Delt helgedagsmodul for norske fridager.
 *
 * Bygger på `date-holidays` (samme pakke som lønnsprofilen bruker for å
 * flytte lønn til nærmeste virkedag). Samlet her så både økonomi og
 * egenfrekvens deler én kilde til «er dette en fridag?».
 */

import Holidays from 'date-holidays';

// Singleton — instansiering er treg (~ms), gjenbruk på tvers av kall.
const norHolidays = new Holidays('NO');

/** Norsk offentlig helligdag (røddag), f.eks. 17. mai, 1. pinsedag. */
export function isNorwegianHoliday(d: Date): boolean {
	const result = norHolidays.isHoliday(d);
	if (!result) return false;
	return result.some((h) => h.type === 'public');
}

/** Lørdag eller søndag (lokal tid). */
export function isWeekend(d: Date): boolean {
	const dow = d.getDay();
	return dow === 0 || dow === 6;
}

/** Helg eller norsk helligdag — en «fridag» i hverdags-aware forstand. */
export function isNonWorkingDay(d: Date): boolean {
	return isWeekend(d) || isNorwegianHoliday(d);
}

/**
 * Som {@link isNonWorkingDay}, men for en lokal ISO-dato (YYYY-MM-DD).
 * Tolker datoen kl. 12 lokal tid så tidssone-kanter ikke flytter dagen.
 */
export function isNonWorkingIsoDay(isoDay: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
	if (!match) return false;
	const [, y, m, d] = match;
	return isNonWorkingDay(new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0));
}
