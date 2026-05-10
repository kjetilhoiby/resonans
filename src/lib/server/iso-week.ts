/**
 * ISO 8601 week helpers brukt av sjekkliste-/dagskontekst.
 * Eksempel-kontekstnøkkel for en dag: "week:2026-W17:day:2026-04-20".
 */

/** Return ISO week key like "2026-W17" for an ISO date string ("YYYY-MM-DD"). */
export function isoWeekKeyForDate(isoDate: string): string {
	const [y, m, d] = isoDate.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	const dayNum = date.getUTCDay() || 7;
	date.setUTCDate(date.getUTCDate() + 4 - dayNum);
	const year = date.getUTCFullYear();
	const yearStart = new Date(Date.UTC(year, 0, 1));
	const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Build day-context string for an ISO date, e.g. "2026-04-20" → "week:2026-W17:day:2026-04-20". */
export function dayContextForDate(isoDate: string): string {
	return `week:${isoWeekKeyForDate(isoDate)}:day:${isoDate}`;
}

/** Add `days` calendar days to an ISO date string, returning a new ISO date. */
export function addDaysIso(isoDate: string, days: number): string {
	const [y, m, d] = isoDate.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}
