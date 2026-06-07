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

/** Emoji for a parsed ActivityType value (English keys, e.g. 'cycling', 'yoga'). */
const ACTIVITY_TYPE_EMOJI: Record<string, string> = {
	running: '🏃',
	cycling: '🚴',
	ebike: '🚴',
	walking: '🚶',
	strength: '🏋️',
	swimming: '🏊',
	yoga: '🧘',
	hiit: '⚡',
	rowing: '🚣',
	skiing: '⛷️',
	other: '✅'
};

/** Emoji for a stored `metadata.activityType` value. Falls back to ✅. */
export function activityTypeEmoji(type: string): string {
	return ACTIVITY_TYPE_EMOJI[type] ?? '✅';
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

/**
 * Sort items so åpne kommer øverst, deretter avkryssede, deretter strøkne.
 * Innen hver bøtte beholdes opprinnelig rekkefølge (sortOrder/createdAt).
 */
type WithStatus = { checked: boolean; skippedAt?: string | Date | null };
export function sortByStatus<T extends WithStatus>(items: T[]): T[] {
	const open: T[] = [];
	const checked: T[] = [];
	const skipped: T[] = [];
	for (const item of items) {
		if (item.skippedAt) skipped.push(item);
		else if (item.checked) checked.push(item);
		else open.push(item);
	}
	return [...open, ...checked, ...skipped];
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

// ── Sted og reise («Sted:» / «kjøre til … kl …») ───────────────────────────
//
// Et punkt skrevet «Sted: Trondheim» er ikke en avkryssbar oppgave, men
// dag-kontekst (driver værmelding for stedet og chat-kontekst). Reisesegmenter
// («kjøre/båt/fly til X kl NN.NN») er fortsatt avkryssbare, men får et eget
// transport-ikon og sorteres som tidfestede når et klokkeslett er med.
//
// Parserne er rene (ingen nettverk) og deles av server (ved oppretting, der vi
// lagrer `metadata.kind`) og klient (visning + fallback for punkter laget før
// denne funksjonen fantes, som bare bærer rå tekst).

export interface ParsedLocation {
	name: string;
}

const LOCATION_PREFIX_PATTERN = /^sted\s*[:：]\s*(.+?)\s*$/i;

/** Parse «Sted: Trondheim» → { name: 'Trondheim' }. Returnerer null hvis ikke et sted-punkt. */
export function parseLocationPrefix(text: string): ParsedLocation | null {
	const m = text.match(LOCATION_PREFIX_PATTERN);
	if (!m) return null;
	const name = m[1].trim();
	return name ? { name } : null;
}

export type TravelMode = 'drive' | 'boat' | 'flight';

export interface ParsedTravel {
	mode: TravelMode;
	destination: string;
}

const TRAVEL_PATTERNS: Array<[RegExp, TravelMode]> = [
	[/^(?:kj[øo]retur|kj[øo]rer|kj[øo]re|kj[øo]r)\s+til\s+(.+)$/i, 'drive'],
	[/^(?:b[åa]t|ferge|ferje)\s+til\s+(.+)$/i, 'boat'],
	[/^(?:flyr|flyet|fly)\s+til\s+(.+)$/i, 'flight']
];

/** Parse «kjøre til Trondheim kl 12.00» / «båt til Håøya» / «fly til Oslo kl 14:30». */
export function parseTravelPrefix(text: string): ParsedTravel | null {
	for (const [pattern, mode] of TRAVEL_PATTERNS) {
		const m = text.match(pattern);
		if (m) {
			// Fjern et eventuelt klokkeslett fra destinasjonen (vises i egen tidschip).
			const destination = stripTimeFromText(m[1].trim()).replace(/[\s,.;–-]+$/, '').trim();
			if (destination) return { mode, destination };
		}
	}
	return null;
}

const TRAVEL_MODE_ICON: Record<TravelMode, string> = {
	drive: '🚗',
	boat: '⛴️',
	flight: '✈️'
};

export function travelModeIcon(mode: TravelMode): string {
	return TRAVEL_MODE_ICON[mode];
}

const TRAVEL_MODE_LABEL: Record<TravelMode, string> = {
	drive: 'Kjøretur',
	boat: 'Båt',
	flight: 'Fly'
};

export function travelModeLabel(mode: TravelMode): string {
	return TRAVEL_MODE_LABEL[mode];
}

type ContextItemLike = {
	text: string;
	metadata?: { kind?: string; locationName?: string; travelMode?: TravelMode } | null;
};

/** Et sted-kontekst-punkt (ikke avkryssbart). Sjekker både lagret metadata og rå tekst. */
export function isLocationItem(item: ContextItemLike): boolean {
	return item.metadata?.kind === 'location' || parseLocationPrefix(item.text) !== null;
}

/** Visningsnavn for et sted-punkt (metadata-navn, ellers parset fra teksten). */
export function locationDisplayName(item: ContextItemLike): string {
	if (item.metadata?.locationName) return item.metadata.locationName;
	const parsed = parseLocationPrefix(item.text);
	return parsed ? parsed.name : item.text;
}

/** Transportmodus for et reisesegment, eller null. Sjekker metadata og rå tekst. */
export function getTravelMode(item: ContextItemLike): TravelMode | null {
	if (item.metadata?.kind === 'travel' && item.metadata.travelMode) return item.metadata.travelMode;
	const parsed = parseTravelPrefix(item.text);
	return parsed ? parsed.mode : null;
}

// ── Opphold-aggregering ─────────────────────────────────────────────────────
//
// «Sted: Trondheim» tre dager på rad blir til ett opphold (første→siste dato).
// Brukt server-side til chat-kontekst og import til reise-/ferieplan. Ren funksjon.

export interface DayLocationEntry {
	date: string; // ISO 'YYYY-MM-DD'
	place: string;
	lat?: number;
	lon?: number;
}

export interface LocationStay {
	place: string;
	startDate: string; // ISO
	endDate: string; // ISO
	lat?: number;
	lon?: number;
}

/** Antall kalenderdager fra aIso til bIso (kan være negativ). Ren UTC-basert. */
function isoDayDiff(aIso: string, bIso: string): number {
	const [ay, am, ad] = aIso.split('-').map(Number);
	const [by, bm, bd] = bIso.split('-').map(Number);
	return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/**
 * Slå sammen dag-for-dag-steder til opphold: sammenhengende datoer (gap ≤ 1 dag)
 * med samme sted blir ett opphold. Ulikt sted eller hull > 1 dag starter et nytt.
 */
export function aggregateStays(entries: DayLocationEntry[]): LocationStay[] {
	const sorted = [...entries]
		.filter((e) => e.place && e.date)
		.sort((a, b) => a.date.localeCompare(b.date));
	const stays: LocationStay[] = [];
	for (const e of sorted) {
		const last = stays[stays.length - 1];
		const gap = last ? isoDayDiff(last.endDate, e.date) : Infinity;
		if (last && last.place.toLowerCase() === e.place.toLowerCase() && gap >= 0 && gap <= 1) {
			if (e.date > last.endDate) last.endDate = e.date;
			if (last.lat == null && e.lat != null) {
				last.lat = e.lat;
				last.lon = e.lon;
			}
		} else {
			stays.push({ place: e.place, startDate: e.date, endDate: e.date, lat: e.lat, lon: e.lon });
		}
	}
	return stays;
}
