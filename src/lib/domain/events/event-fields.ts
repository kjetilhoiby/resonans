/**
 * Feltene på et arrangement: hva som er gyldig, hvordan det leses og hvordan
 * det sies.
 *
 * Ligger i domenelaget fordi fire lag trenger den — flaten validerer før den
 * sender, endepunktet validerer før det skriver, billett-lesingen normaliserer
 * det modellen fant, og dagsvisningen formaterer det som vises. Én kopi, ellers
 * kan en verdi godtas ett sted og avvises et annet.
 */

import { osloDayKey } from '$lib/domain/oslo-time';

export type EventKind = 'konsert' | 'teater' | 'kino' | 'sport' | 'annet';

export const EVENT_KINDS: Array<{ key: EventKind; label: string; emoji: string }> = [
	{ key: 'konsert', label: 'Konsert', emoji: '🎵' },
	{ key: 'teater', label: 'Teater', emoji: '🎭' },
	{ key: 'kino', label: 'Kino', emoji: '🎬' },
	{ key: 'sport', label: 'Sport', emoji: '🏟️' },
	{ key: 'annet', label: 'Annet', emoji: '🎟️' }
];

export function eventKindMeta(kind: string | null | undefined) {
	return EVENT_KINDS.find((k) => k.key === kind) ?? EVENT_KINDS[EVENT_KINDS.length - 1];
}

export function normalizeEventKind(value: unknown): EventKind | null {
	if (typeof value !== 'string') return null;
	const lower = value.trim().toLowerCase();
	const hit = EVENT_KINDS.find((k) => k.key === lower);
	return hit ? hit.key : null;
}

/** ISO-dato (`YYYY-MM-DD`) eller null. Kalenderdagen valideres, ikke bare formen. */
export function normalizeEventDate(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
	if (!match) return null;
	const [, y, m, d] = match;
	const year = Number(y);
	const month = Number(m);
	const day = Number(d);
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	// 31. februar er en gyldig streng og en ugyldig dato.
	const probe = new Date(Date.UTC(year, month - 1, day));
	if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
	return `${y}-${m}-${d}`;
}

/**
 * Klokkeslett som `HH:MM`, Oslo-veggklokke.
 *
 * Tar imot `19.30` og `1930` også — en billett skriver tiden på alle tre måter,
 * og et uttrekk som kaster «19.30» tvinger brukeren til å skrive den inn igjen.
 */
export function normalizeEventTime(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const raw = value.trim();
	if (!raw) return null;
	const match = /^(\d{1,2})[:.]?(\d{2})$/.exec(raw);
	if (!match) return null;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour > 23 || minute > 59) return null;
	return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Trimmet tekst, eller null. Tom streng er «ikke oppgitt», ikke en verdi. */
export function normalizeText(value: unknown, maxLength = 400): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return trimmed.slice(0, maxLength);
}

/**
 * En lenke vi tør legge i en `href`.
 *
 * BARE http og https. `javascript:` og `data:` i en href kjører i brukerens
 * økt, og denne verdien kan komme fra et uttrekk av et bilde — altså fra noe vi
 * ikke kontrollerer. Hviteliste, aldri svarteliste: en denylist over farlige
 * skjemaer må kjenne dem alle, en allowlist trenger bare kjenne de to vi vil ha.
 */
export function normalizeUrl(value: unknown): string | null {
	const text = normalizeText(value, 2000);
	if (!text) return null;
	// Uten skjema er «cosmopolite.no/billett» ikke en gyldig URL for `new URL`,
	// men det er det brukeren limer inn. Anta https framfor å avvise.
	const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
	try {
		const url = new URL(candidate);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		return url.toString();
	} catch {
		return null;
	}
}

export function normalizeTicketCount(value: unknown): number | null {
	const num = typeof value === 'string' ? Number(value.trim()) : value;
	if (typeof num !== 'number' || !Number.isFinite(num)) return null;
	const rounded = Math.round(num);
	if (rounded < 1 || rounded > 99) return null;
	return rounded;
}

export interface EventTimeFields {
	eventDate: string;
	endDate: string | null;
	startTime: string | null;
	doorsTime: string | null;
}

/**
 * Sorteringsnøkkel: dato først, så tid.
 *
 * Et arrangement uten tidspunkt sorteres SIST på sin dag (`24:00`), ikke først.
 * En konsert vi ikke har lest tidspunktet på ennå skal ikke legge seg over
 * frokosten i dagsvisningen.
 */
export function eventSortKey(event: { eventDate: string; startTime?: string | null }): string {
	return `${event.eventDate}T${event.startTime ?? '24:00'}`;
}

export function sortEvents<T extends { eventDate: string; startTime?: string | null }>(
	events: T[]
): T[] {
	return [...events].sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)));
}

/**
 * Siste dagen arrangementet dekker. `endDate` bare når den ligger etter starten
 * — en sluttdato før startdato er data vi ikke kan stole på, og å late som om
 * den gjelder ville skjult arrangementet fra dagen det faktisk er på.
 */
export function lastDayOf(event: { eventDate: string; endDate?: string | null }): string {
	if (event.endDate && event.endDate > event.eventDate) return event.endDate;
	return event.eventDate;
}

/** Dekker arrangementet denne dagen? Flerdagsarrangementer dekker alle dagene mellom. */
export function coversDay(
	event: { eventDate: string; endDate?: string | null },
	dayIso: string
): boolean {
	return dayIso >= event.eventDate && dayIso <= lastDayOf(event);
}

/**
 * Er arrangementet over?
 *
 * Måles mot DAGEN, ikke mot klokkeslettet. En konsert kl. 19 skal stå under
 * «kommer» hele den dagen — flytter den seg til «tidligere» kl. 19:01 mens
 * brukeren står i køen, ser lista ut som en feil.
 */
export function isPast(
	event: { eventDate: string; endDate?: string | null },
	now: Date = new Date()
): boolean {
	return lastDayOf(event) < osloDayKey(now);
}

export function splitByTime<T extends { eventDate: string; endDate?: string | null; startTime?: string | null }>(
	events: T[],
	now: Date = new Date()
): { upcoming: T[]; past: T[] } {
	const sorted = sortEvents(events);
	const upcoming = sorted.filter((e) => !isPast(e, now));
	// Tidligere vises nyeste først: det man leter etter er det som nettopp var.
	const past = sorted.filter((e) => isPast(e, now)).reverse();
	return { upcoming, past };
}

const WEEKDAY = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
const MONTH = [
	'januar', 'februar', 'mars', 'april', 'mai', 'juni',
	'juli', 'august', 'september', 'oktober', 'november', 'desember'
];

/** «fredag 14. november» — uten årstall når det er inneværende år. */
export function formatEventDate(dateIso: string, now: Date = new Date()): string {
	const [y, m, d] = dateIso.split('-').map(Number);
	const weekday = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
	const base = `${weekday} ${d}. ${MONTH[m - 1]}`;
	const thisYear = Number(osloDayKey(now).slice(0, 4));
	return y === thisYear ? base : `${base} ${y}`;
}

/**
 * Hvor lenge til.
 *
 * Grunnen til at arrangementet finnes i appen i det hele tatt er at det er langt
 * fram — «om 6 uker» er informasjonen, ikke datoen. Null når det er i dag eller
 * er over; da sier datoen alt.
 */
export function describeCountdown(
	event: { eventDate: string; endDate?: string | null },
	now: Date = new Date()
): string | null {
	const today = osloDayKey(now);
	if (event.eventDate <= today) return null;
	const days = daysBetween(today, event.eventDate);
	if (days === 1) return 'I morgen';
	if (days < 7) return `Om ${days} dager`;
	if (days < 14) return 'Om en uke';
	if (days < 60) return `Om ${Math.round(days / 7)} uker`;
	return `Om ${Math.round(days / 30)} måneder`;
}

export function daysBetween(fromIso: string, toIso: string): number {
	const from = Date.parse(`${fromIso}T00:00:00Z`);
	const to = Date.parse(`${toIso}T00:00:00Z`);
	return Math.round((to - from) / 86_400_000);
}

/**
 * Tidslinja på selve dagen: «Dørene 18:00 · Start 19:30».
 *
 * Dørene nevnes bare når de er ULIKE starten. Er de like, er det ett tall sagt
 * to ganger — og et arrangement der de faktisk er like sier bare «19:30».
 */
export function formatEventTime(event: {
	startTime?: string | null;
	doorsTime?: string | null;
}): string | null {
	const start = event.startTime ?? null;
	const doors = event.doorsTime ?? null;
	if (doors && start && doors !== start) return `Dørene ${doors} · Start ${start}`;
	if (start) return start;
	if (doors) return `Dørene ${doors}`;
	return null;
}

/** «Oslo Spektrum · Inngang C · Rad 12, sete 5» — bare feltene som finnes. */
export function formatEventPlace(event: {
	venue?: string | null;
	entrance?: string | null;
	seat?: string | null;
}): string | null {
	const parts = [event.venue, event.entrance, event.seat].filter(
		(p): p is string => typeof p === 'string' && p.trim().length > 0
	);
	return parts.length > 0 ? parts.join(' · ') : null;
}
