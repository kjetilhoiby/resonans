/**
 * Ferie-sesonger: norske skoleferier, når «Planlegg ferie»-knappen blir synlig,
 * og hjelpere for å matche eksisterende ferie-temaer mot en sesong.
 *
 * Brukes både klient (FamilyDashboard — knapp + nedtelling) og server
 * (create-endepunkt — navn + omtrentlig vindu). Rene funksjoner, testbare.
 */

export type FerieSeasonKey =
	| 'vinterferie'
	| 'paaskeferie'
	| 'sommerferie'
	| 'hostferie'
	| 'juleferie';

export interface FerieSeasonDef {
	key: FerieSeasonKey;
	label: string;
	emoji: string;
	/** Når knappen blir synlig (måned 1-12 / dag), samme kalenderår som ferien. */
	planOpens: { month: number; day: number };
}

export const FERIE_SEASONS: Record<FerieSeasonKey, FerieSeasonDef> = {
	sommerferie: { key: 'sommerferie', label: 'Sommerferie', emoji: '🏖️', planOpens: { month: 3, day: 1 } },
	hostferie: { key: 'hostferie', label: 'Høstferie', emoji: '🍂', planOpens: { month: 8, day: 15 } },
	juleferie: { key: 'juleferie', label: 'Juleferie', emoji: '🎄', planOpens: { month: 10, day: 1 } },
	vinterferie: { key: 'vinterferie', label: 'Vinterferie', emoji: '⛷️', planOpens: { month: 1, day: 5 } },
	paaskeferie: { key: 'paaskeferie', label: 'Påskeferie', emoji: '🐣', planOpens: { month: 2, day: 1 } }
};

export const FERIE_SEASON_KEYS: FerieSeasonKey[] = [
	'vinterferie',
	'paaskeferie',
	'sommerferie',
	'hostferie',
	'juleferie'
];

// ── Dato-hjelpere (UTC, dag-granularitet) ────────────────────────────────────

function utc(year: number, month1: number, day: number): Date {
	return new Date(Date.UTC(year, month1 - 1, day));
}

function addDays(d: Date, n: number): Date {
	return new Date(d.getTime() + n * 86400000);
}

function startOfUTCDay(d: Date): Date {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function toISODate(d: Date): string {
	return d.toISOString().slice(0, 10);
}

function parseISO(iso: string): Date | null {
	if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
	const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
	return isNaN(d.getTime()) ? null : d;
}

/** Påskedag (1. påskedag) for et år — Anonymous Gregorian-algoritmen. */
export function easterSunday(year: number): Date {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = mars, 4 = april
	const day = ((h + l - 7 * m + 114) % 31) + 1;
	return utc(year, month, day);
}

/** Omtrentlig ferievindu for en sesong i et gitt år (kan justeres i dashboardet). */
export function ferieWindow(key: FerieSeasonKey, year: number): { start: Date; end: Date } {
	switch (key) {
		case 'vinterferie':
			return { start: utc(year, 2, 17), end: utc(year, 2, 23) }; // ~uke 8
		case 'paaskeferie': {
			const e = easterSunday(year);
			return { start: addDays(e, -6), end: addDays(e, 1) }; // mandag i stille uke → 2. påskedag
		}
		case 'sommerferie':
			return { start: utc(year, 6, 20), end: utc(year, 8, 17) };
		case 'hostferie':
			return { start: utc(year, 10, 1), end: utc(year, 10, 7) }; // ~uke 40
		case 'juleferie':
			return { start: utc(year, 12, 20), end: utc(year + 1, 1, 2) };
	}
}

function planOpensDate(key: FerieSeasonKey, year: number): Date {
	const { month, day } = FERIE_SEASONS[key].planOpens;
	return utc(year, month, day);
}

export interface FerieOccurrence {
	key: FerieSeasonKey;
	label: string;
	emoji: string;
	year: number;
	start: Date;
	end: Date;
}

/** Neste forekomst av en sesong som ennå ikke har startet, relativt til `today`. */
export function nextOccurrence(key: FerieSeasonKey, today: Date): FerieOccurrence {
	const t = startOfUTCDay(today);
	let year = t.getUTCFullYear();
	let w = ferieWindow(key, year);
	if (t >= w.start) {
		year += 1;
		w = ferieWindow(key, year);
	}
	const def = FERIE_SEASONS[key];
	return { key, label: def.label, emoji: def.emoji, year, start: w.start, end: w.end };
}

/**
 * Hvilken (sesong, år) en dato hører til — for å matche eksisterende ferie-temaer.
 * Bruker en margin så bruker-justerte vinduer som er litt av fortsatt matcher.
 */
export function classifyDate(iso: string, marginDays = 14): { key: FerieSeasonKey; year: number } | null {
	const d = parseISO(iso);
	if (!d) return null;
	const baseYear = d.getUTCFullYear();
	for (const key of FERIE_SEASON_KEYS) {
		for (const y of [baseYear - 1, baseYear, baseYear + 1]) {
			const w = ferieWindow(key, y);
			if (d >= addDays(w.start, -marginDays) && d <= addDays(w.end, marginDays)) {
				return { key, year: y };
			}
		}
	}
	return null;
}

/** Nøkkel for «finnes det allerede en plan»-sjekk. */
export function occurrenceId(key: FerieSeasonKey, year: number): string {
	return `${key}:${year}`;
}

/**
 * Utled sesong + vindu fra et ferie-temanavn som «Sommerferie 2026».
 * Brukes av ferie-dashboardet til å prefylle vinduet når profilen mangler
 * datoer (selvhelbredende — matcher familie-kortets sesongramme).
 */
export function seasonFromThemeName(name: string): FerieOccurrence | null {
	const m = name.trim().match(/^(.+?)\s+(\d{4})$/);
	if (!m) return null;
	const label = m[1].trim().toLowerCase();
	const year = Number(m[2]);
	if (!Number.isInteger(year)) return null;
	const def = FERIE_SEASON_KEYS.map((k) => FERIE_SEASONS[k]).find((d) => d.label.toLowerCase() === label);
	if (!def) return null;
	const w = ferieWindow(def.key, year);
	return { key: def.key, label: def.label, emoji: def.emoji, year, start: w.start, end: w.end };
}

/**
 * Neste ferie som bør planlegges: den nærmeste kommende forekomsten der
 * planleggingsvinduet er åpnet (today >= planOpens) og det ikke finnes en plan.
 * `plannedIds` er settet av occurrenceId-er som allerede har et ferie-tema.
 */
export function nextUnplannedFerie(today: Date, plannedIds: Set<string>): FerieOccurrence | null {
	const t = startOfUTCDay(today);
	const candidates = FERIE_SEASON_KEYS.map((key) => nextOccurrence(key, t))
		.filter((occ) => t >= planOpensDate(occ.key, occ.year))
		.filter((occ) => !plannedIds.has(occurrenceId(occ.key, occ.year)))
		.sort((a, b) => a.start.getTime() - b.start.getTime());
	return candidates[0] ?? null;
}

/** Hele dager fra `today` til `target` (negativ hvis target er passert). */
export function daysUntil(targetISO: string, today: Date = new Date()): number | null {
	const target = parseISO(targetISO);
	if (!target) return null;
	const t = startOfUTCDay(today);
	return Math.round((target.getTime() - t.getTime()) / 86400000);
}
