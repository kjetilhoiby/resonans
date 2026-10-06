/**
 * Akser-tidslinjen som svar på spørsmål: «når kom jeg på jobb», «hvordan kom jeg
 * dit», «når var jeg sist på hytta». Rent, så reglene kan testes; hentingen bor i
 * `$lib/server/movement/movement-read.ts`, verktøyet i `$lib/ai/tools/query-movement.ts`.
 *
 * ## Hva som er en ankomst
 *
 * Det første oppholdet på stedet den dagen, MED en reise rett foran seg. Et opphold
 * som begynner ved midnatt er ikke en ankomst — det er natta som fortsetter (Akser
 * klipper opphold over midnatt til dagen). Uten den regelen ville «når kom jeg hjem»
 * svart 00:00 hver eneste dag.
 *
 * ## Steder
 *
 * Akser eier stedene; Resonans har dem fra `PUT /api/apps/akser/places`. Et sted
 * brukeren ikke har navngitt («Nytt sted») omtales med kategorien, aldri med
 * koordinater. Et opphold uten sted har et avrundet sentrum, og det oppgis heller
 * ikke — svaret sier «et sted uten navn».
 */

import type { MovementMode, StoredJourney, StoredStay } from './timeline';
import type { PlaceCategory } from './places';

export interface MovementPlace {
	id: string;
	name: string;
	category: PlaceCategory;
	named: boolean;
	archived: boolean;
	/**
	 * Navn på det samme stedet i Ekko (koblet automatisk eller bekreftet). Et sted Akser
	 * kaller «Nytt sted» kan hete «Barnehagen» i Ekko, og da er det det brukeren sier.
	 */
	aliases?: string[];
}

export interface MovementData {
	stays: StoredStay[];
	journeys: StoredJourney[];
	places: MovementPlace[];
}

export const MODE_LABELS: Record<MovementMode, string> = {
	walking: 'gange',
	running: 'løping',
	cycling: 'sykkel',
	e_bike: 'elsykkel',
	driving: 'bil',
	transit: 'kollektivt',
	unknown: 'ukjent transportform'
};

const CATEGORY_LABELS: Record<PlaceCategory, string> = {
	home: 'hjemme',
	work: 'jobb',
	gym: 'trening',
	shop: 'butikk',
	restaurant: 'restaurant',
	transport: 'kollektivknutepunkt',
	recreation: 'fritid',
	friend: 'hos venner',
	family: 'hos familie',
	unknown: 'et sted uten navn'
};

/** Ordene folk bruker om kategoriene. Navnet på et sted vinner alltid over disse. */
const CATEGORY_WORDS: Record<string, PlaceCategory> = {
	hjem: 'home',
	hjemme: 'home',
	huset: 'home',
	jobb: 'work',
	jobben: 'work',
	kontor: 'work',
	kontoret: 'work',
	arbeid: 'work',
	gym: 'gym',
	treningssenter: 'gym',
	treningssenteret: 'gym',
	studio: 'gym'
};

const OSLO_TIME = new Intl.DateTimeFormat('nb-NO', {
	timeZone: 'Europe/Oslo',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23'
});

const WEEKDAY = new Intl.DateTimeFormat('nb-NO', { timeZone: 'Europe/Oslo', weekday: 'long' });

export function osloClock(iso: string): string {
	return OSLO_TIME.format(new Date(iso));
}

function weekday(date: string): string {
	return WEEKDAY.format(new Date(`${date}T12:00:00Z`));
}

function km(meters: number): number {
	return Math.round(meters / 100) / 10;
}

function minutes(start: string, end: string): number {
	return Math.round((Date.parse(end) - Date.parse(start)) / 60_000);
}

// MARK: - Steder

export function placeLabel(placeId: string | null, places: ReadonlyMap<string, MovementPlace>): string {
	if (!placeId) return CATEGORY_LABELS.unknown;
	const place = places.get(placeId);
	if (!place) return CATEGORY_LABELS.unknown;
	if (place.named) return place.name;
	if (place.aliases?.length) return place.aliases[0];
	return place.category === 'unknown' ? CATEGORY_LABELS.unknown : `${CATEGORY_LABELS[place.category]} (uten navn)`;
}

/** Små bokstaver, uten aksenter, og ø/æ skrevet ut — «Hytta» og «hytte» skal møtes. */
export function normalizePlaceText(text: string): string {
	return text
		.toLowerCase()
		.replace(/ø/g, 'o')
		.replace(/æ/g, 'ae')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9 ]+/g, ' ')
		.trim();
}

/** «hytta», «hytte», «hytten» → «hytt». Bare for ord over fire tegn. */
function stem(word: string): string {
	if (word.length <= 4) return word;
	for (const suffix of ['ene', 'en', 'et', 'a', 'e']) {
		if (word.endsWith(suffix) && word.length - suffix.length >= 4) return word.slice(0, -suffix.length);
	}
	return word;
}

export type PlaceMatch =
	| { kind: 'name'; places: MovementPlace[] }
	| { kind: 'category'; category: PlaceCategory; places: MovementPlace[] }
	| { kind: 'none' };

/**
 * Finner stedene brukeren mener. Et navn vinner over en kategori: heter et sted
 * «Jobben i Bergen», er det det brukeren sier «jobben i Bergen» om. Treffer
 * ingenting, sier verktøyet hvilke steder som finnes — det gjetter ikke.
 */
const STOP_WORDS = new Set(['pa', 'i', 'til', 'hos', 'min', 'mitt', 'mi', 'var', 'vart', 'ved', 'the']);

export function matchPlaces(query: string, places: readonly MovementPlace[]): PlaceMatch {
	const words = normalizePlaceText(query)
		.split(/\s+/)
		.filter((w) => w && !STOP_WORDS.has(w));
	if (words.length === 0) return { kind: 'none' };
	const stems = words.map(stem);

	const nameMatches = (name: string) => {
		const nameWords = normalizePlaceText(name).split(/\s+/).map(stem);
		if (normalizePlaceText(name) === normalizePlaceText(query)) return true;
		return stems.every((s) => nameWords.some((w) => w.startsWith(s) || (s.startsWith(w) && w.length >= 4)));
	};
	const byName = places.filter(
		(place) => (place.named && nameMatches(place.name)) || (place.aliases ?? []).some(nameMatches)
	);
	if (byName.length > 0) return { kind: 'name', places: byName };

	for (const word of words) {
		const category = CATEGORY_WORDS[word];
		if (category) {
			return { kind: 'category', category, places: places.filter((p) => p.category === category) };
		}
	}
	return { kind: 'none' };
}

// MARK: - Reiser

export interface LegSummary {
	mode: string;
	km: number;
	minutes: number;
	/** `rettet` når brukeren har satt transportformen, `fra økt` når fasit fra Resonans. */
	source?: 'rettet' | 'fra økt';
}

export function summarizeLegs(journey: StoredJourney): LegSummary[] {
	return journey.legs.map((leg) => {
		const summary: LegSummary = {
			mode: MODE_LABELS[leg.mode],
			km: km(leg.distanceMeters),
			minutes: minutes(leg.startedAt, leg.endedAt)
		};
		if (leg.modeSource === 'user') summary.source = 'rettet';
		if (leg.modeSource === 'label') summary.source = 'fra økt';
		return summary;
	});
}

/** «elsykkel 7,2 km» eller «gange 0,4 km, kollektivt 6,1 km». */
export function describeJourneyModes(journey: StoredJourney): string {
	return summarizeLegs(journey)
		.map((leg) => `${leg.mode} ${leg.km.toLocaleString('nb-NO')} km`)
		.join(', ');
}

/** Transportformen med lengst distanse — det brukeren mener med «hvordan kom jeg dit». */
export function mainMode(journey: StoredJourney): MovementMode {
	const byMode = new Map<MovementMode, number>();
	for (const leg of journey.legs) byMode.set(leg.mode, (byMode.get(leg.mode) ?? 0) + leg.distanceMeters);
	let best: MovementMode = 'unknown';
	let bestMeters = -1;
	for (const [mode, meters] of byMode) {
		if (meters > bestMeters) {
			best = mode;
			bestMeters = meters;
		}
	}
	return best;
}

// MARK: - Én dag

export interface DayEntry {
	kind: 'opphold' | 'reise';
	from: string;
	to: string;
	place?: string;
	fromPlace?: string;
	toPlace?: string;
	km?: number;
	legs?: LegSummary[];
}

export interface DaySummary {
	date: string;
	weekday: string;
	entries: DayEntry[];
	kmByMode: Record<string, number>;
}

export function summarizeDay(date: string, data: MovementData): DaySummary {
	const places = new Map(data.places.map((p) => [p.id, p]));
	const items: Array<{ at: string; entry: DayEntry }> = [];

	for (const stay of data.stays.filter((s) => s.date === date)) {
		items.push({
			at: stay.startedAt,
			entry: {
				kind: 'opphold',
				from: osloClock(stay.startedAt),
				to: endClock(stay.endedAt, date),
				place: placeLabel(stay.placeId, places)
			}
		});
	}

	const metersByMode: Record<string, number> = {};
	for (const journey of data.journeys.filter((j) => j.date === date)) {
		for (const leg of journey.legs) {
			const label = MODE_LABELS[leg.mode];
			metersByMode[label] = (metersByMode[label] ?? 0) + leg.distanceMeters;
		}
		items.push({
			at: journey.startedAt,
			entry: {
				kind: 'reise',
				from: osloClock(journey.startedAt),
				to: endClock(journey.endedAt, date),
				fromPlace: placeLabel(journey.fromPlaceId, places),
				toPlace: placeLabel(journey.toPlaceId, places),
				km: km(journey.distanceMeters),
				legs: summarizeLegs(journey)
			}
		});
	}

	items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
	const kmByMode = Object.fromEntries(Object.entries(metersByMode).map(([mode, meters]) => [mode, km(meters)]));
	return { date, weekday: weekday(date), entries: items.map((i) => i.entry), kmByMode };
}

/** Et opphold som varer til midnatt skrives «24:00», ikke «00:00». */
function endClock(iso: string, date: string): string {
	const clock = osloClock(iso);
	if (clock === '00:00' && osloDate(iso) !== date) return '24:00';
	return clock;
}

const OSLO_DATE = new Intl.DateTimeFormat('sv', { timeZone: 'Europe/Oslo' });

function osloDate(iso: string): string {
	return OSLO_DATE.format(new Date(iso));
}

// MARK: - Ankomster

export interface Arrival {
	date: string;
	weekday: string;
	arrivedAt: string;
	/** Hovedtransportformen på reisen dit. */
	by: string | null;
	route: string | null;
	minutes: number | null;
	/** Når brukeren dro derfra sist den dagen. Null om oppholdet varte til midnatt. */
	leftAt: string | null;
}

export interface ArrivalSummary {
	place: string;
	arrivals: Arrival[];
	/** Median ankomsttid over dagene, «HH:MM». */
	typicalArrival: string | null;
	/** Hovedtransportform → antall dager. */
	byMode: Record<string, number>;
	daysWithoutArrival: number;
}

/** En reise som slutter mer enn så lenge før oppholdet, er ikke reisen dit. */
const ARRIVAL_JOURNEY_GAP_MS = 15 * 60_000;

/** Den siste reisen som sluttet rett før ankomsten. Akser lar dem møtes, men en kort pause skal ikke gjøre ankomsten transportløs. */
function journeyInto(stay: StoredStay, journeys: readonly StoredJourney[]): StoredJourney | null {
	const arrival = Date.parse(stay.startedAt);
	let best: StoredJourney | null = null;
	for (const journey of journeys) {
		const end = Date.parse(journey.endedAt);
		if (end > arrival || arrival - end > ARRIVAL_JOURNEY_GAP_MS) continue;
		if (!best || end > Date.parse(best.endedAt)) best = journey;
	}
	return best;
}

export function summarizeArrivals(placeIds: ReadonlySet<string>, label: string, data: MovementData): ArrivalSummary {
	const staysByDate = new Map<string, StoredStay[]>();
	for (const stay of data.stays) {
		if (!stay.placeId || !placeIds.has(stay.placeId)) continue;
		const list = staysByDate.get(stay.date) ?? [];
		list.push(stay);
		staysByDate.set(stay.date, list);
	}

	const arrivals: Arrival[] = [];
	let daysWithoutArrival = 0;
	for (const [date, stays] of [...staysByDate].sort(([a], [b]) => b.localeCompare(a))) {
		stays.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
		// Natta som fortsetter fra i går er ikke en ankomst.
		const arrival = stays.find((s) => osloClock(s.startedAt) !== '00:00' || osloDate(s.startedAt) !== date);
		if (!arrival) {
			daysWithoutArrival++;
			continue;
		}
		const journey = journeyInto(arrival, data.journeys);
		const last = stays[stays.length - 1];
		const leftAt = endClock(last.endedAt, date);
		arrivals.push({
			date,
			weekday: weekday(date),
			arrivedAt: osloClock(arrival.startedAt),
			by: journey ? MODE_LABELS[mainMode(journey)] : null,
			route: journey ? describeJourneyModes(journey) : null,
			minutes: journey ? minutes(journey.startedAt, journey.endedAt) : null,
			leftAt: leftAt === '24:00' ? null : leftAt
		});
	}

	const byMode: Record<string, number> = {};
	for (const arrival of arrivals) {
		if (arrival.by) byMode[arrival.by] = (byMode[arrival.by] ?? 0) + 1;
	}

	return {
		place: label,
		arrivals,
		typicalArrival: medianClock(arrivals.map((a) => a.arrivedAt)),
		byMode,
		daysWithoutArrival
	};
}

function medianClock(clocks: string[]): string | null {
	if (clocks.length === 0) return null;
	const mins = clocks
		.map((c) => {
			const [h, m] = c.split(':').map(Number);
			return h * 60 + m;
		})
		.sort((a, b) => a - b);
	const mid = Math.floor(mins.length / 2);
	const value = mins.length % 2 ? mins[mid] : Math.round((mins[mid - 1] + mins[mid]) / 2);
	return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

// MARK: - Sist besøkt

export interface LastVisit {
	place: string;
	lastDate: string | null;
	lastWeekday: string | null;
	daysAgo: number | null;
	/** Dager med minst ett opphold på stedet i vinduet. */
	visitDays: number;
	hours: number;
}

export function summarizeLastVisit(
	placeIds: ReadonlySet<string>,
	label: string,
	data: MovementData,
	today: string
): LastVisit {
	const stays = data.stays.filter((s) => s.placeId && placeIds.has(s.placeId));
	const days = new Set(stays.map((s) => s.date));
	const lastDate = [...days].sort().at(-1) ?? null;
	const totalMinutes = stays.reduce((sum, s) => sum + minutes(s.startedAt, s.endedAt), 0);
	return {
		place: label,
		lastDate,
		lastWeekday: lastDate ? weekday(lastDate) : null,
		daysAgo: lastDate ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${lastDate}T12:00:00Z`)) / 86_400_000) : null,
		visitDays: days.size,
		hours: Math.round(totalMinutes / 6) / 10
	};
}

// MARK: - Stedslista

export interface PlaceOverview {
	name: string;
	category: string;
	visitDays: number;
	lastDate: string | null;
}

/** Navngitte steder, mest besøkt først. Automatiske steder telles, men listes ikke. */
export function summarizePlaces(data: MovementData): { places: PlaceOverview[]; unnamedPlaces: number } {
	const visits = new Map<string, Set<string>>();
	for (const stay of data.stays) {
		if (!stay.placeId) continue;
		const set = visits.get(stay.placeId) ?? new Set<string>();
		set.add(stay.date);
		visits.set(stay.placeId, set);
	}
	const named = data.places.filter((p) => (p.named || p.aliases?.length) && !p.archived);
	return {
		places: named
			.map((p) => {
				const days = visits.get(p.id) ?? new Set<string>();
				return {
					name: p.named ? p.name : p.aliases![0],
					category: CATEGORY_LABELS[p.category],
					visitDays: days.size,
					lastDate: [...days].sort().at(-1) ?? null
				};
			})
			.sort((a, b) => b.visitDays - a.visitDays || a.name.localeCompare(b.name, 'nb')),
		unnamedPlaces: data.places.filter((p) => !p.named && !p.aliases?.length && !p.archived).length
	};
}
