/**
 * Lesing og skriving av arrangementer.
 *
 * Én skrivevei (`saveEvent`/`updateEvent`), som ernæringsmålene: flaten,
 * API-et og et framtidig chat-verktøy skal validere med de samme reglene, og et
 * felt som godtas ett sted men avvises et annet er den verste varianten.
 */

import { db } from '$lib/db';
import { events, type EventPrepItem, type EventTicketFile } from '$lib/db/schema';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { defaultPrep, normalizePrep } from '$lib/domain/events/prep';
import { normalizeEventInput, type EventInput, type ValidationResult } from '$lib/domain/events/event-input';
import type { EventRecord } from '$lib/domain/events/event-record';
import { ticketFullUrl, ticketThumbUrl } from '$lib/server/events/ticket-upload';

export type { EventInput, ValidationResult, EventRecord };

type Row = typeof events.$inferSelect;

function toRecord(row: Row): EventRecord {
	return {
		id: row.id,
		title: row.title,
		kind: row.kind,
		eventDate: row.eventDate,
		endDate: row.endDate,
		startTime: row.startTime,
		doorsTime: row.doorsTime,
		venue: row.venue,
		address: row.address,
		entrance: row.entrance,
		seat: row.seat,
		ticketCount: row.ticketCount,
		bookingReference: row.bookingReference,
		notes: row.notes,
		ticketUrl: row.ticketUrl,
		tickets: normalizeTickets(row.tickets).map((ticket) => ({
			...ticket,
			thumbUrl: ticketThumbUrl(ticket),
			fullUrl: ticketFullUrl(ticket)
		})),
		prep: normalizePrep(row.prep),
		extractionSource: row.extractionSource,
		themeId: row.themeId,
		status: row.status,
		createdAt: row.createdAt.toISOString()
	};
}

/** Vedleggsrader fra jsonb. Uten url er raden ubrukelig og droppes. */
export function normalizeTickets(value: unknown): EventTicketFile[] {
	if (!Array.isArray(value)) return [];
	const out: EventTicketFile[] = [];
	for (const raw of value) {
		if (!raw || typeof raw !== 'object') continue;
		const t = raw as Record<string, unknown>;
		if (typeof t.url !== 'string' || !t.url) continue;
		out.push({
			url: t.url,
			publicId: typeof t.publicId === 'string' ? t.publicId : '',
			kind: t.kind === 'image' || t.kind === 'document' ? t.kind : 'other',
			name: typeof t.name === 'string' ? t.name : 'billett',
			mimeType: typeof t.mimeType === 'string' ? t.mimeType : '',
			addedAt: typeof t.addedAt === 'string' ? t.addedAt : new Date().toISOString(),
			// Utsnittet må overleve en runde gjennom basen. Lista er en hviteliste
			// (som `toPublicCronRun`), så et nytt felt må legges til HER — glemmes
			// det, faller oppdelingen stille tilbake til hele siden.
			region: normalizeRegion(t.region),
			label: typeof t.label === 'string' && t.label ? t.label : null
		});
	}
	return out;
}

/** Et lagret utsnitt, eller null. Verdier utenfor bildet er ikke et utsnitt. */
function normalizeRegion(value: unknown): { top: number; height: number } | null {
	if (!value || typeof value !== 'object') return null;
	const r = value as Record<string, unknown>;
	const top = typeof r.top === 'number' ? r.top : NaN;
	const height = typeof r.height === 'number' ? r.height : NaN;
	if (!Number.isFinite(top) || !Number.isFinite(height)) return null;
	if (top < 0 || height <= 0 || top + height > 1.0001) return null;
	return { top, height };
}

export async function listEvents(userId: string): Promise<EventRecord[]> {
	const rows = await db
		.select()
		.from(events)
		.where(eq(events.userId, userId))
		.orderBy(desc(events.eventDate));
	return rows.map(toRecord);
}

export async function getEvent(userId: string, id: string): Promise<EventRecord | null> {
	const [row] = await db
		.select()
		.from(events)
		.where(and(eq(events.userId, userId), eq(events.id, id)))
		.limit(1);
	return row ? toRecord(row) : null;
}

/**
 * Arrangementer som berører et datovindu.
 *
 * Et flerdagsarrangement som STARTET før vinduet, men fortsatt pågår, må være
 * med — derfor `eventDate <= til` mot `coalesce(endDate, eventDate) >= fra`, og
 * ikke et filter på startdatoen alene.
 */
export async function listEventsInRange(
	userId: string,
	fromIso: string,
	toIso: string
): Promise<EventRecord[]> {
	const rows = await db
		.select()
		.from(events)
		.where(
			and(
				eq(events.userId, userId),
				lte(events.eventDate, toIso),
				// Siste dagen arrangementet dekker, i SQL. Et JS-filter etterpå ville
				// betydd at spørringen hentet HELE historikken hver gang ukeplanen
				// lastes — den vokser, og vinduet gjør ikke det.
				gte(sql`coalesce(${events.endDate}, ${events.eventDate})`, fromIso)
			)
		)
		.orderBy(asc(events.eventDate));
	return rows.map(toRecord);
}

export async function createEvent(
	userId: string,
	input: EventInput,
	extras: { tickets?: EventTicketFile[]; prep?: EventPrepItem[]; extracted?: Record<string, unknown> | null; extractionSource?: string | null } = {}
): Promise<ValidationResult<EventRecord>> {
	const normalized = normalizeEventInput(input, { partial: false });
	if (!normalized.ok) return { ok: false, error: normalized.error };

	const [row] = await db
		.insert(events)
		.values({
			userId,
			...(normalized.value as { title: string; eventDate: string }),
			tickets: extras.tickets ?? [],
			// Forberedelsene er standardsettet med mindre kalleren sier noe annet.
			// En tom liste sendt eksplisitt respekteres — noen arrangementer krever
			// ingenting, og to uhakede punkter der er støy.
			prep: extras.prep ?? defaultPrep(),
			extracted: extras.extracted ?? null,
			extractionSource: extras.extractionSource ?? 'manual'
		})
		.returning();

	return { ok: true, value: toRecord(row!) };
}

export async function updateEvent(
	userId: string,
	id: string,
	input: EventInput
): Promise<ValidationResult<EventRecord>> {
	const normalized = normalizeEventInput(input, { partial: true });
	if (!normalized.ok) return { ok: false, error: normalized.error };

	// Retting av ÉN dato mot en lagret annen: sjekken over ser bare det som ble
	// sendt, så en ny startdato etter en lagret sluttdato ville sluppet gjennom.
	const patch = normalized.value!;
	if (typeof patch.eventDate === 'string' || typeof patch.endDate === 'string') {
		const existing = await getEvent(userId, id);
		if (!existing) return { ok: false, error: 'Fant ikke arrangementet.' };
		const start = (patch.eventDate as string) ?? existing.eventDate;
		const end = 'endDate' in patch ? (patch.endDate as string | null) : existing.endDate;
		if (end && end < start) return { ok: false, error: 'Sluttdatoen kan ikke være før startdatoen.' };
	}

	const [row] = await db
		.update(events)
		.set({ ...patch, updatedAt: new Date() })
		.where(and(eq(events.userId, userId), eq(events.id, id)))
		.returning();

	if (!row) return { ok: false, error: 'Fant ikke arrangementet.' };
	return { ok: true, value: toRecord(row) };
}

/** Skriv forberedelseslista i sin helhet. Den regnes rent i domenelaget. */
export async function setEventPrep(
	userId: string,
	id: string,
	prep: EventPrepItem[]
): Promise<EventRecord | null> {
	const [row] = await db
		.update(events)
		.set({ prep, updatedAt: new Date() })
		.where(and(eq(events.userId, userId), eq(events.id, id)))
		.returning();
	return row ? toRecord(row) : null;
}

export async function setEventTickets(
	userId: string,
	id: string,
	tickets: EventTicketFile[]
): Promise<EventRecord | null> {
	const [row] = await db
		.update(events)
		.set({ tickets, updatedAt: new Date() })
		.where(and(eq(events.userId, userId), eq(events.id, id)))
		.returning();
	return row ? toRecord(row) : null;
}

export async function deleteEvent(userId: string, id: string): Promise<boolean> {
	const rows = await db
		.delete(events)
		.where(and(eq(events.userId, userId), eq(events.id, id)))
		.returning({ id: events.id });
	return rows.length > 0;
}
