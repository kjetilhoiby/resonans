/**
 * Pure utility functions for ChecklistSheet.
 * Extracted to keep the component thin.
 */

/** Format a date ISO string to a Norwegian day label (I dag, I morgen, etc.). */
export function formatDayLabel(dateIso: string): string {
	const todayIso = new Date().toLocaleDateString('sv', { timeZone: 'Europe/Oslo' });
	const tomorrow = new Date();
	tomorrow.setDate(tomorrow.getDate() + 1);
	const tomorrowIso = tomorrow.toLocaleDateString('sv', { timeZone: 'Europe/Oslo' });
	const yesterday = new Date();
	yesterday.setDate(yesterday.getDate() - 1);
	const yesterdayIso = yesterday.toLocaleDateString('sv', { timeZone: 'Europe/Oslo' });
	if (dateIso === todayIso) return 'I dag';
	if (dateIso === tomorrowIso) return 'I morgen';
	if (dateIso === yesterdayIso) return 'I går';
	return new Intl.DateTimeFormat('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' })
		.format(new Date(dateIso + 'T12:00:00'));
}

/** Build a calendar href for linking from a checklist to the week plan. */
export function buildCalendarHref(context: string | null): string {
	if (!context) return '/ukeplan';

	const dayMatch = context.match(/^week:(\d{4}-W\d{2}):day:(\d{4}-\d{2}-\d{2})$/);
	if (dayMatch) {
		const weekKey = encodeURIComponent(dayMatch[1]);
		const dayKey = encodeURIComponent(dayMatch[2]);
		return `/ukeplan?week=${weekKey}&day=${dayKey}`;
	}

	const weekMatch = context.match(/^week:(\d{4}-W\d{2})$/);
	if (weekMatch) {
		const weekKey = encodeURIComponent(weekMatch[1]);
		return `/ukeplan?week=${weekKey}`;
	}

	return '/ukeplan';
}

/** Check if a context string matches the day-checklist pattern. */
export function isDayContext(context: string | null): boolean {
	return !!context?.match(/^week:\d{4}-W\d{2}:day:\d{4}-\d{2}-\d{2}$/);
}

/** Extract the day date from a day-context string, or null. */
export function extractDayDate(context: string | null): string | null {
	if (!context) return null;
	const m = context.match(/^week:(?:\d{4}-W\d{2}):day:(\d{4}-\d{2}-\d{2})$/);
	return m ? m[1] : null;
}

/** True if the context is a day-checklist for today (Oslo-tid). Rutiner hører kun til dagens dagsliste. */
export function isTodayDayContext(context: string | null, now: Date = new Date()): boolean {
	const date = extractDayDate(context);
	if (!date) return false;
	const todayIso = now.toLocaleDateString('sv', { timeZone: 'Europe/Oslo' });
	return date === todayIso;
}

/** Extract the week key from a week-context string, or null. */
export function extractWeekKey(context: string | null): string | null {
	if (!context) return null;
	const m = context.match(/^week:(\d{4}-W\d{2})$/);
	return m ? m[1] : null;
}

/** Compute a display title from checklist context. */
export function computeDisplayTitle(context: string | null, fallbackTitle: string): string {
	if (!context) return fallbackTitle;
	const dayMatch = context.match(/^week:(\d{4}-W\d{2}):day:(\d{4}-\d{2}-\d{2})$/);
	if (dayMatch) return formatDayLabel(dayMatch[2]);
	const weekMatch = context.match(/^week:(\d{4}-W\d{2})$/);
	if (weekMatch) return 'Hele uka';
	return fallbackTitle;
}

/** Compute a target date ISO string given a day-context and an offset (+1 or -1). */
export function computeOffsetDate(context: string | null, offset: number): string | null {
	if (!context) return null;
	const m = context.match(/^week:\d{4}-W\d{2}:day:(\d{4}-\d{2}-\d{2})$/);
	if (!m) return null;
	const d = new Date(m[1] + 'T12:00:00');
	d.setDate(d.getDate() + offset);
	const year = d.getFullYear();
	const month = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/** SVG ring constants for the payoff animation. */
export const RING_RADIUS = 40;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
