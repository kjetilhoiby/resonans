/**
 * Dagen og uka i loggen: summer, måloppnåelse og gruppering.
 *
 * Ligger i domenelaget fordi både Ernæring-flaten, undertema-flisen og
 * chat-verktøyet trenger samme regnestykke.
 */

import { addMacros, describeMacros, EMPTY_MACROS, roundMacros, type NutritionMacros } from './estimate';

export interface LoggedEntry {
	id: string;
	/** ISO-tidspunkt for når måltidet ble spist. */
	timestamp: string;
	label: string;
	macros: NutritionMacros;
	confidence: number;
	imageUrl: string | null;
}

export interface NutritionTargets {
	kcal?: number | null;
	proteinG?: number | null;
}

export interface DaySummary {
	/** ISO-dato, `YYYY-MM-DD`. */
	date: string;
	entries: LoggedEntry[];
	totals: NutritionMacros;
	/** Andel av dagsmålet, 0–1+ (kan overstige 1). Null når målet ikke er satt. */
	kcalShare: number | null;
	proteinShare: number | null;
	/** Kort setning til flisen, f.eks. «1 840 kcal · 96 g protein». */
	summaryLine: string;
}

/**
 * Osloklokka avgjør hvilken dag et måltid tilhører.
 *
 * `timestamp` er UTC i basen. `toISOString().slice(0, 10)` ville lagt et
 * måltid kl. 01:30 norsk tid på dagen før om sommeren — og et sent kveldsmåltid
 * er nettopp det man vil se på riktig dag.
 */
export function osloDateKey(timestamp: string | Date): string {
	const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
	if (Number.isNaN(date.getTime())) return '';
	// sv-SE gir ISO-lignende `YYYY-MM-DD` uten manuell sammensetting.
	return new Intl.DateTimeFormat('sv-SE', {
		timeZone: 'Europe/Oslo',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(date);
}

/** Klokkeslettet i Oslo, `HH:MM`, til loggvisningen. */
export function osloTimeLabel(timestamp: string | Date): string {
	const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
	if (Number.isNaN(date.getTime())) return '';
	return new Intl.DateTimeFormat('nb-NO', {
		timeZone: 'Europe/Oslo',
		hour: '2-digit',
		minute: '2-digit'
	}).format(date);
}

function share(total: number, target: number | null | undefined): number | null {
	if (typeof target !== 'number' || target <= 0) return null;
	return total / target;
}

export function sumEntries(entries: LoggedEntry[]): NutritionMacros {
	return roundMacros(entries.reduce((acc, entry) => addMacros(acc, entry.macros), EMPTY_MACROS));
}

/**
 * Oppsummerer én dag. `date` sendes inn i stedet for å utledes, slik at en dag
 * uten registreringer også kan vises (0 kcal er et svar, tom skjerm er ikke).
 */
export function summarizeDay(
	date: string,
	entries: LoggedEntry[],
	targets: NutritionTargets = {}
): DaySummary {
	const sorted = [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
	const totals = sumEntries(sorted);
	return {
		date,
		entries: sorted,
		totals,
		kcalShare: share(totals.kcal, targets.kcal),
		proteinShare: share(totals.proteinG, targets.proteinG),
		summaryLine: describeMacros(totals)
	};
}

/** Grupperer logg-innslag på Oslo-dato, nyeste dag først. */
export function groupByDay(entries: LoggedEntry[]): Array<{ date: string; entries: LoggedEntry[] }> {
	const byDate = new Map<string, LoggedEntry[]>();
	for (const entry of entries) {
		const key = osloDateKey(entry.timestamp);
		if (!key) continue;
		const list = byDate.get(key);
		if (list) list.push(entry);
		else byDate.set(key, [entry]);
	}
	return [...byDate.entries()]
		.sort((a, b) => b[0].localeCompare(a[0]))
		.map(([date, list]) => ({ date, entries: list }));
}

/**
 * Snitt per *loggført* dag, ikke per kalenderdag i vinduet.
 *
 * Med delvis logging ville kalenderdager gitt et kunstig lavt snitt — og et
 * lavt snitt som skyldes at man glemte å logge, er verre enn ingen tall.
 * `loggedDays` returneres så flaten kan si hvor mange dager tallet bygger på.
 */
export function averagePerLoggedDay(entries: LoggedEntry[]): {
	loggedDays: number;
	perDay: NutritionMacros;
} {
	const days = groupByDay(entries);
	if (days.length === 0) return { loggedDays: 0, perDay: { ...EMPTY_MACROS } };

	const total = days.reduce((acc, day) => addMacros(acc, sumEntries(day.entries)), EMPTY_MACROS);
	return {
		loggedDays: days.length,
		perDay: roundMacros({
			kcal: total.kcal / days.length,
			proteinG: total.proteinG / days.length,
			carbsG: total.carbsG / days.length,
			fatG: total.fatG / days.length
		})
	};
}
