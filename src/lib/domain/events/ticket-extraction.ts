/**
 * Fra det modellen leste av en billett til et arrangement vi tør skrive.
 *
 * Ren normalisering, uten nettverk: modellen får lov til å svare upresist (den
 * leser et skjermbilde), og alt som ikke lar seg tolke blir null framfor en
 * gjetning. Et felt vi gjettet på er verre enn et tomt felt — brukeren ser det
 * utfylte feltet og stoler på det, mens et tomt felt inviterer til å se på
 * billetten.
 *
 * Utkastet er et FORSLAG. Ingenting lagres uten at brukeren har sett det; det
 * er derfor `confidence` og `warnings` følger med ut til flaten.
 */

import {
	normalizeEventDate,
	normalizeEventKind,
	normalizeEventTime,
	normalizeText,
	normalizeTicketCount,
	type EventKind
} from './event-fields';

export interface TicketDraft {
	title: string | null;
	kind: EventKind | null;
	eventDate: string | null;
	endDate: string | null;
	startTime: string | null;
	doorsTime: string | null;
	venue: string | null;
	address: string | null;
	entrance: string | null;
	seat: string | null;
	ticketCount: number | null;
	bookingReference: string | null;
	notes: string | null;
	confidence: 'low' | 'medium' | 'high';
	/** Hva brukeren må se etter selv. Tom liste er et fullgodt utkast. */
	warnings: string[];
}

const MONTHS: Record<string, number> = {
	januar: 1, jan: 1,
	februar: 2, feb: 2,
	mars: 3, mar: 3,
	april: 4, apr: 4,
	mai: 5,
	juni: 6, jun: 6,
	juli: 7, jul: 7,
	august: 8, aug: 8,
	september: 9, sep: 9, sept: 9,
	oktober: 10, okt: 10,
	november: 11, nov: 11,
	desember: 12, des: 12
};

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

/**
 * En dato fra billettens egne ord.
 *
 * Tre former dekker det man faktisk ser: `2026-11-14`, `14.11.2026` og
 * «fre 14. november 2026». Uten årstall antas det FØRSTE året der datoen ligger
 * fram i tid — en billett gjelder aldri noe som har vært, og «14. november» på
 * en billett kjøpt i desember er neste år.
 */
export function parseTicketDate(value: unknown, now: Date = new Date()): string | null {
	if (typeof value !== 'string') return null;
	const raw = value.trim().toLowerCase();
	if (!raw) return null;

	const iso = normalizeEventDate(raw);
	if (iso) return iso;

	// 14.11.2026 / 14-11-2026 / 14/11/26
	const numeric = /(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/.exec(raw);
	if (numeric) {
		const day = Number(numeric[1]);
		const month = Number(numeric[2]);
		let year = Number(numeric[3]);
		if (year < 100) year += 2000;
		return normalizeEventDate(`${year}-${pad(month)}-${pad(day)}`);
	}

	// «fredag 14. november 2026», «14 nov»
	const named = /(\d{1,2})\.?\s*([a-zæøå]+)\.?(?:\s+(\d{4}))?/.exec(raw);
	if (named) {
		const day = Number(named[1]);
		const month = MONTHS[named[2]];
		if (month) {
			if (named[3]) return normalizeEventDate(`${Number(named[3])}-${pad(month)}-${pad(day)}`);
			return firstFutureOccurrence(day, month, now);
		}
	}

	return null;
}

/**
 * Året som gjør datoen framtidig.
 *
 * Inneværende år hvis dagen ikke har vært, ellers neste. Dagen selv teller som
 * framtidig: en billett lest om morgenen gjelder som regel den kvelden.
 */
function firstFutureOccurrence(day: number, month: number, now: Date): string | null {
	const todayIso = now.toISOString().slice(0, 10);
	const thisYear = Number(todayIso.slice(0, 4));
	for (const year of [thisYear, thisYear + 1]) {
		const candidate = normalizeEventDate(`${year}-${pad(month)}-${pad(day)}`);
		if (candidate && candidate >= todayIso) return candidate;
	}
	return normalizeEventDate(`${thisYear + 1}-${pad(month)}-${pad(day)}`);
}

/**
 * Klokkeslett fra fritekst («kl. 19:30», «19.30», «Dørene åpner 18.00»).
 *
 * Krever minutter. «kl 19» alene finnes på plakater, men et arrangement som
 * begynner 19:00 og et som begynner 19:30 er ulike kvelder, og en tapt halvtime
 * er verre enn et tomt felt brukeren fyller selv.
 */
export function parseTicketTime(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const direct = normalizeEventTime(value);
	if (direct) return direct;
	const match = /(\d{1,2})[:.](\d{2})/.exec(value);
	return match ? normalizeEventTime(`${match[1]}:${match[2]}`) : null;
}

/**
 * Inngangen, som den står.
 *
 * Billetter skriver den som «Inngang C», «Port 2», «Gate B», «Dør 4». Vi
 * beholder ordet framfor å normalisere til et tall: brukeren skal kunne
 * sammenligne det som står på skjermen med det som står over døra.
 */
export function parseEntrance(value: unknown): string | null {
	const text = normalizeText(value, 80);
	if (!text) return null;
	// «C» alene er ikke en inngang man kan lete etter — sett på ordet.
	if (/^[a-zæøå0-9]{1,3}$/i.test(text)) return `Inngang ${text.toUpperCase()}`;
	return text;
}

function confidenceOf(value: unknown): 'low' | 'medium' | 'high' {
	return value === 'high' || value === 'medium' || value === 'low' ? value : 'low';
}

/**
 * Bygg utkastet.
 *
 * `raw` er hva modellen enn svarte — ukjente nøkler og feil typer er forventet,
 * ikke et unntak. Derfor leses hvert felt for seg gjennom sin egen normalisering
 * framfor med en spread: en spread ville sluppet inn felter ingen validerte, og
 * hadde vi lagt til en kolonne senere ville modellen kunnet skrive i den.
 */
export function buildTicketDraft(raw: unknown, now: Date = new Date()): TicketDraft {
	const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

	const eventDate = parseTicketDate(data.eventDate ?? data.date, now);
	const endDate = parseTicketDate(data.endDate, now);
	const startTime = parseTicketTime(data.startTime ?? data.time);
	const doorsTime = parseTicketTime(data.doorsTime ?? data.doors);
	const title = normalizeText(data.title, 200);

	const warnings: string[] = [];
	if (!title) warnings.push('Fant ikke navnet på arrangementet.');
	if (!eventDate) warnings.push('Fant ingen dato — fyll den inn selv.');
	if (!startTime && !doorsTime) warnings.push('Fant ikke klokkeslett.');
	if (eventDate && endDate && endDate < eventDate) {
		warnings.push('Sluttdatoen lå før startdatoen og ble forkastet.');
	}

	// En dato uten årstall ble gjettet framtidig; si det, siden det er en
	// slutning og ikke en avlesning.
	if (eventDate && typeof (data.eventDate ?? data.date) === 'string') {
		const source = String(data.eventDate ?? data.date);
		if (!/\d{4}/.test(source)) {
			warnings.push(`Årstallet sto ikke på billetten — satt til ${eventDate.slice(0, 4)}.`);
		}
	}

	return {
		title,
		kind: normalizeEventKind(data.kind),
		eventDate,
		endDate: endDate && eventDate && endDate > eventDate ? endDate : null,
		startTime,
		doorsTime: doorsTime && doorsTime !== startTime ? doorsTime : null,
		venue: normalizeText(data.venue, 200),
		address: normalizeText(data.address, 300),
		entrance: parseEntrance(data.entrance),
		seat: normalizeText(data.seat, 120),
		ticketCount: normalizeTicketCount(data.ticketCount),
		bookingReference: normalizeText(data.bookingReference ?? data.reference, 120),
		notes: normalizeText(data.notes, 800),
		confidence: confidenceOf(data.confidence),
		warnings
	};
}

/** Har utkastet nok til å være verdt å vise? Uten dato og tittel er det ingenting. */
export function draftIsUsable(draft: TicketDraft): boolean {
	return Boolean(draft.title || draft.eventDate);
}
