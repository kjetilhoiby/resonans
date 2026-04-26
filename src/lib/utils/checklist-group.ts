/**
 * Shared utilities for grouping repeated checklist items.
 *
 * Items created from "Løpetur 3 ganger" are expanded server-side into
 * "Løpetur (1/3)", "Løpetur (2/3)", "Løpetur (3/3)". This module
 * re-groups them client-side for display.
 */

export type GroupedChecklistEntry<T extends { text: string }> =
	| { type: 'single'; item: T }
	| { type: 'group'; label: string; items: T[] };

const REPEAT_PATTERN = /^(.+?)\s+\((\d+)\/(\d+)\)$/;

export function groupChecklistItems<T extends { text: string }>(
	items: T[]
): GroupedChecklistEntry<T>[] {
	const result: GroupedChecklistEntry<T>[] = [];
	const groupMap = new Map<string, T[]>();

	for (const item of items) {
		const match = item.text.match(REPEAT_PATTERN);
		if (match && parseInt(match[3]) > 1) {
			const baseLabel = match[1];
			if (!groupMap.has(baseLabel)) {
				const groupItems: T[] = [];
				groupMap.set(baseLabel, groupItems);
				result.push({ type: 'group', label: baseLabel, items: groupItems });
			}
			groupMap.get(baseLabel)!.push(item);
		} else {
			result.push({ type: 'single', item });
		}
	}
	return result;
}

const ACTIVITY_EMOJI: Array<[RegExp, string]> = [
	[/\b(løp|jogg|jogge?tur|løpetur|sprin|running)/, '🏃'],
	[/\b(sykl|sykkel|sykkeltur|bike|biking)/, '🚴'],
	[/\b(gåtur|tur\b|walking|turgå|gå\b)/, '🚶'],
	[/\b(yoga|mikroyoga|yogaøkt)/, '🧘'],
	[/\b(styrke|vektløft|gym)/, '🏋️'],
	[/\b(svøm|swim)/, '🏊'],
	[/\b(hiit|intervall)/, '⚡'],
	[/\b(ro|roing|rowing)/, '🚣'],
	[/\b(ski|langrenn|alpint|skitur)/, '⛷️'],
];

export function activityEmoji(label: string): string {
	const lower = label.toLowerCase();
	for (const [pattern, emoji] of ACTIVITY_EMOJI) {
		if (pattern.test(lower)) return emoji;
	}
	return '';
}

type WithTime = { metadata?: { timeHour?: number; timeMinute?: number } | null };

/** Sort items with a scheduled time to the top, then chronologically. Untimed items keep original order. */
export function sortByTime<T extends WithTime>(items: T[]): T[] {
	const timed = items.filter((i) => i.metadata?.timeHour !== undefined);
	const untimed = items.filter((i) => i.metadata?.timeHour === undefined);
	timed.sort((a, b) => {
		const aMin = (a.metadata!.timeHour! * 60) + (a.metadata?.timeMinute ?? 0);
		const bMin = (b.metadata!.timeHour! * 60) + (b.metadata?.timeMinute ?? 0);
		return aMin - bMin;
	});
	return [...timed, ...untimed];
}

export function formatItemTime(hour: number, minute: number): string {
	return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Strip time expressions from item text for display when a chip already shows the time. */
export function stripTimeFromText(text: string): string {
	let result = text
		// "kl. 16", "kl. 14:15", "kl. 14.15", "klokka 14:30"
		.replace(/\s*kl(?:okka)?\.?\s*\d{1,2}(?:[.:]\d{2})?\s*/gi, ' ')
		// bare "HH:MM" or "HH.MM"
		.replace(/\s*\b([01]?\d|2[0-3])[.:]([0-5]\d)\b\s*/g, ' ')
		.trim();
	return result || text;
}
