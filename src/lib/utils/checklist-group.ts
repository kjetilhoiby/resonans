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
