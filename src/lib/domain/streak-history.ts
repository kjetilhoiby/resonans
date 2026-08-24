/**
 * Streak-historikk som kalender: hvilke dager holdt, og hvilke perioder nådde
 * terskelen.
 *
 * ## Hvorfor en kalender
 *
 * Et streak-kort svarer på «hvor mange på rad nå». Det neste spørsmålet er alltid
 * «hva skjedde?» — når brøt den, hvor tett har det egentlig vært, var forrige
 * måned bedre. Et tall kan ikke svare på det; en kalender kan, fordi rekka blir en
 * form man ser framfor et tall man må tro på.
 *
 * ## Radene ER periodene
 *
 * For `count_per_window` med sju dagers vindu grupperer streaken på mandag-ankrede
 * uker (`windowIndex`), og `monthGrid` legger ukene som rader mandag–søndag. Da kan
 * hver rad bære periodens fasit («2 av 2 ✓») — og den fasiten regnes på HELE
 * historikken, ikke bare på dagene som er synlige i måneden. En uke som krysser et
 * månedsskifte skal vise samme tall i begge månedene.
 *
 * Andre vindulengder enn sju dager faller ikke sammen med kalenderuker. Da vises
 * ingen periodemarkør i det hele tatt, framfor en som ligner: en rad merket «1 av
 * 2» for en periode raden bare dekker halve, er verre enn ingen merking.
 */

import {
	dayKeyFromNumber,
	dayNumber,
	windowIndex,
	windowStartDay,
	type StreakConfig,
	type StreakRule
} from './streaks';
import { monthGrid, monthTitle } from './month-grid';

/** Én dag med hendelser. `count` er antall, siden to løpeturer teller som to. */
export interface StreakHistoryDay {
	date: string;
	count: number;
}

export interface StreakCalendarCell {
	date: string;
	count: number;
	isToday: boolean;
	/** Dager etter i dag: ingenting har skjedd der ennå, og ingenting er glemt. */
	isFuture: boolean;
}

export interface StreakCalendarRow {
	cells: (StreakCalendarCell | null)[];
	/** Periodens fasit for `count_per_window` med ukesvindu, ellers null. */
	window: { count: number; target: number; met: boolean } | null;
}

export interface StreakCalendarMonth {
	month: string;
	title: string;
	rows: StreakCalendarRow[];
	/** Dager med hendelse i måneden, og hvor mange dager som er gått av den. */
	daysWithEvent: number;
	daysElapsed: number;
	/** Sum hendelser i måneden — høyere enn `daysWithEvent` når en dag har flere. */
	events: number;
}

/** Dagsnøkkel → antall, fra en liste som kan inneholde duplikater. */
export function countByDay(dayKeys: string[]): StreakHistoryDay[] {
	const counts = new Map<string, number>();
	for (const key of dayKeys) counts.set(key, (counts.get(key) ?? 0) + 1);
	return [...counts.entries()]
		.map(([date, count]) => ({ date, count }))
		.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function buildStreakCalendar(input: {
	/** «YYYY-MM». */
	month: string;
	/** Hele historikken, ikke bare måneden — periodene regnes på tvers. */
	days: StreakHistoryDay[];
	todayKey: string;
	rule: StreakRule;
	config: StreakConfig;
}): StreakCalendarMonth {
	const { month, days, todayKey, rule, config } = input;
	const byDate = new Map(days.map((d) => [d.date, d.count]));
	const today = dayNumber(todayKey);

	const windowDays = Math.max(1, config.windowDays ?? 7);
	const target = Math.max(1, config.threshold ?? 1);
	// Bare ukesvinduer faller sammen med kalenderrader. Se modulkommentaren.
	const showWindows = rule === 'count_per_window' && windowDays === 7;

	const perWindow = new Map<number, number>();
	if (showWindows) {
		for (const day of days) {
			const idx = windowIndex(dayNumber(day.date), windowDays);
			perWindow.set(idx, (perWindow.get(idx) ?? 0) + day.count);
		}
	}

	let daysWithEvent = 0;
	let daysElapsed = 0;
	let events = 0;

	const rows: StreakCalendarRow[] = monthGrid(month).map((week) => {
		const cells = week.map((date) => {
			if (!date) return null;
			const dayNum = dayNumber(date);
			const count = byDate.get(date) ?? 0;
			if (dayNum <= today) {
				daysElapsed++;
				if (count > 0) daysWithEvent++;
				events += count;
			}
			return {
				date,
				count,
				isToday: dayNum === today,
				isFuture: dayNum > today
			};
		});

		let window: StreakCalendarRow['window'] = null;
		if (showWindows) {
			// Radens mandag — også når måneden starter midt i uka og cellen er null.
			const anchor = cells.find((cell): cell is StreakCalendarCell => cell !== null);
			if (anchor) {
				const idx = windowIndex(dayNumber(anchor.date), windowDays);
				const count = perWindow.get(idx) ?? 0;
				// Perioder som ikke har begynt ennå får ingen fasit.
				const started = windowStartDay(idx, windowDays) <= today;
				if (started) window = { count, target, met: count >= target };
			}
		}

		return { cells, window };
	});

	return {
		month,
		title: monthTitle(month),
		rows,
		daysWithEvent,
		daysElapsed,
		events
	};
}

/** Måneden en dagsnøkkel hører til, «YYYY-MM». */
export function monthOf(dayKey: string): string {
	return dayKey.slice(0, 7);
}

/** Første måned med en hendelse — så navigasjonen kan stoppe der historikken gjør. */
export function firstMonthWithEvents(days: StreakHistoryDay[]): string | null {
	return days.length > 0 ? monthOf(days[0].date) : null;
}

/** Dagsnøkkelen `offset` dager fra en annen. Praktisk i tester og i UI-hjelpere. */
export function shiftDayKey(dayKey: string, offset: number): string {
	return dayKeyFromNumber(dayNumber(dayKey) + offset);
}
