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

/** All 7 ISO dates (Mon–Sun) for an ISO week key like "2026-W31". */
export function datesForIsoWeek(weekKey: string): string[] {
	const match = weekKey.match(/^(\d{4})-W(\d{2})$/);
	if (!match) return [];
	const year = Number(match[1]);
	const week = Number(match[2]);
	// 4. januar er alltid i uke 1 (ISO 8601); finn mandagen i uke 1 derfra.
	const jan4 = new Date(Date.UTC(year, 0, 4));
	const jan4Day = jan4.getUTCDay() || 7;
	const week1Monday = new Date(jan4);
	week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
	const monday = new Date(week1Monday);
	monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
	return Array.from({ length: 7 }, (_, i) => {
		const d = new Date(monday);
		d.setUTCDate(monday.getUTCDate() + i);
		return d.toISOString().slice(0, 10);
	});
}
