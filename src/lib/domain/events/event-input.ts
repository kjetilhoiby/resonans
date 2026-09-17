/**
 * Validering av feltene på et arrangement.
 *
 * Bor i domenelaget og ikke i lagringen fordi tre innganger deler den —
 * `POST /api/arrangementer`, `PATCH` på ett arrangement, og flaten før den
 * sender. Og for å kunne testes uten en base: reglene her er
 * forretningslogikk (hva er en gyldig dato, kan en sluttdato ligge før
 * starten), ikke SQL.
 */

import {
	normalizeEventDate,
	normalizeEventKind,
	normalizeEventTime,
	normalizeText,
	normalizeTicketCount,
	normalizeUrl
} from './event-fields';

/** Feltene en klient får sette. Ikke `userId`, ikke `id`, ikke `createdAt`. */
export interface EventInput {
	title?: unknown;
	kind?: unknown;
	eventDate?: unknown;
	endDate?: unknown;
	startTime?: unknown;
	doorsTime?: unknown;
	venue?: unknown;
	address?: unknown;
	entrance?: unknown;
	seat?: unknown;
	ticketCount?: unknown;
	bookingReference?: unknown;
	notes?: unknown;
	ticketUrl?: unknown;
	themeId?: unknown;
	status?: unknown;
}

export interface ValidationResult<T> {
	ok: boolean;
	error?: string;
	value?: T;
}

/**
 * Normaliser innkommende felter.
 *
 * `partial` skiller en oppretting fra en retting: ved oppretting må tittel og
 * dato finnes, ved retting betyr et utelatt felt «ikke endre». Et felt som
 * eksplisitt sendes som null NULLES — ellers kunne man aldri fjerne en inngang
 * man hadde skrevet feil. Samme regel som nærings-målene.
 */
export function normalizeEventInput(
	input: EventInput,
	{ partial }: { partial: boolean }
): ValidationResult<Record<string, unknown>> {
	const out: Record<string, unknown> = {};

	const has = (key: keyof EventInput) => Object.prototype.hasOwnProperty.call(input, key);

	if (has('title')) {
		const title = normalizeText(input.title, 200);
		if (!title) return { ok: false, error: 'Arrangementet må ha et navn.' };
		out.title = title;
	} else if (!partial) {
		return { ok: false, error: 'Arrangementet må ha et navn.' };
	}

	if (has('eventDate')) {
		const date = normalizeEventDate(input.eventDate);
		if (!date) return { ok: false, error: 'Ugyldig dato — bruk ÅÅÅÅ-MM-DD.' };
		out.eventDate = date;
	} else if (!partial) {
		return { ok: false, error: 'Arrangementet må ha en dato.' };
	}

	if (has('endDate')) {
		if (input.endDate === null || input.endDate === '') {
			out.endDate = null;
		} else {
			const end = normalizeEventDate(input.endDate);
			if (!end) return { ok: false, error: 'Ugyldig sluttdato.' };
			out.endDate = end;
		}
	}

	for (const field of ['startTime', 'doorsTime'] as const) {
		if (!has(field)) continue;
		if (input[field] === null || input[field] === '') {
			out[field] = null;
			continue;
		}
		const time = normalizeEventTime(input[field]);
		if (!time) return { ok: false, error: 'Ugyldig klokkeslett — bruk TT:MM.' };
		out[field] = time;
	}

	const textFields: Array<[keyof EventInput, number]> = [
		['venue', 200],
		['address', 300],
		['entrance', 80],
		['seat', 120],
		['bookingReference', 120],
		['notes', 2000]
	];
	for (const [field, max] of textFields) {
		if (!has(field)) continue;
		out[field] = normalizeText(input[field], max);
	}

	if (has('ticketUrl')) {
		if (input.ticketUrl === null || input.ticketUrl === '') {
			out.ticketUrl = null;
		} else {
			const url = normalizeUrl(input.ticketUrl);
			if (!url) return { ok: false, error: 'Lenka må være en http- eller https-adresse.' };
			out.ticketUrl = url;
		}
	}

	if (has('kind')) {
		out.kind = input.kind === null || input.kind === '' ? null : normalizeEventKind(input.kind);
	}

	if (has('ticketCount')) {
		out.ticketCount =
			input.ticketCount === null || input.ticketCount === '' ? null : normalizeTicketCount(input.ticketCount);
	}

	if (has('themeId')) {
		out.themeId = typeof input.themeId === 'string' && input.themeId ? input.themeId : null;
	}

	if (has('status')) {
		if (input.status !== 'planned' && input.status !== 'cancelled') {
			return { ok: false, error: 'Ukjent status.' };
		}
		out.status = input.status;
	}

	// En sluttdato før startdato er ikke et flerdagsarrangement. Sjekken må se
	// begge verdiene, så den kan ikke ligge i feltnormaliseringen over.
	if (typeof out.endDate === 'string' && typeof out.eventDate === 'string' && out.endDate < out.eventDate) {
		return { ok: false, error: 'Sluttdatoen kan ikke være før startdatoen.' };
	}

	return { ok: true, value: out };
}
