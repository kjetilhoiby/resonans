/**
 * day-location-context.ts
 *
 * Bygger en kort kontekst-blokk om HVOR brukeren er i dag, basert på dagens
 * sjekkliste: «Sted: X»-punkter (dag-kontekst) og reisesegmenter
 * («kjøre/båt/fly til X [kl T]»). Injiseres i chat-systemprompten slik at
 * assistenten kan gi stedstilpasset kontekst (vær, reisetid, lokale forslag).
 *
 * Fase B i sted/reise-arbeidet. Leser kun — ingen skriv.
 */

import { db } from '$lib/db';
import { checklists, users } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { localIsoDay } from './nudge-time';
import { dayContextForDate, addDaysIso } from './iso-week';
import { computeStaysFromDayPlans, formatStayRange } from './stays';
import { dayWindowInfo } from './trip-geo';
import {
	isLocationItem,
	locationDisplayName,
	getTravelMode,
	travelModeLabel,
	formatItemTime
} from '$lib/utils/checklist-group';

interface DayItem {
	text: string;
	parentId?: string | null;
	skippedAt?: string | Date | null;
	metadata?: {
		kind?: string;
		locationName?: string;
		travelMode?: 'drive' | 'boat' | 'flight';
		destination?: string;
		timeHour?: number;
		timeMinute?: number;
		arriveByHour?: number;
		arriveByMinute?: number;
		lat?: number;
		lon?: number;
	} | null;
}

/* ── Strukturert dagskontekst (delt mellom chat og Ekko) ─────────────────── */

export interface DayMovement {
	mode: 'drive' | 'boat' | 'flight';
	destination?: string;
	time: string | null; // 'HH:MM' eller null (planlagt avgang, kun visning)
	/** Server-geokodet koordinat for målet. Sendes alltid sammen — begge eller ingen. */
	destLat?: number;
	destLon?: number;
	/** Ankomstfrist for målet, 'HH:MM' lokal tid samme dag. Utelatt når ingen frist. */
	arriveBy?: string;
}

export interface DayStay {
	place: string;
	startDate: string; // ISO
	endDate: string; // ISO
	dayNo: number;
	totalDays: number;
}

export interface DayContext {
	date: string; // ISO 'YYYY-MM-DD'
	locations: string[]; // distinkte sted-navn for dagen
	stay: DayStay | null; // flerdagers opphold som dekker dagen
	movement: DayMovement[]; // reisesegmenter (kjøre/båt/fly)
}

/**
 * Samle dagens sted-/reise-kontekst som STRUKTUR fra dagens sjekkliste. Én ren
 * datakilde delt av chat-prompten (formateres til prosa under) og Ekko (JSON via
 * /api/apps/day), slik at de ikke kan drive fra hverandre. `date` default = i dag
 * i brukerens tidssone.
 */
export async function gatherDayContext(
	userId: string,
	date?: string,
	timezone?: string
): Promise<DayContext> {
	let tz = timezone;
	if (!tz) {
		const user = await db.query.users.findFirst({
			where: eq(users.id, userId),
			columns: { timezone: true }
		});
		tz = user?.timezone ?? 'Europe/Oslo';
	}

	const day = date ?? localIsoDay(tz, new Date());
	const ctx = dayContextForDate(day);
	const empty: DayContext = { date: day, locations: [], stay: null, movement: [] };

	const checklist = await db.query.checklists.findFirst({
		where: and(eq(checklists.userId, userId), eq(checklists.context, ctx)),
		with: { items: true }
	});
	if (!checklist?.items?.length) return empty;

	const topItems = (checklist.items as DayItem[]).filter((i) => !i.parentId && !i.skippedAt);

	const locations = [
		...new Set(topItems.filter((i) => isLocationItem(i)).map((i) => locationDisplayName(i)))
	];

	// Opphold (Fase C): finn et evt. flerdagers opphold som dekker dagen, så
	// konsumenten vet hvor lenge brukeren er borte («dag 2 av 3»), ikke bare i dag.
	let stay: DayStay | null = null;
	if (locations.length > 0) {
		try {
			const stays = await computeStaysFromDayPlans(userId, addDaysIso(day, -21), addDaysIso(day, 45));
			const current = stays.find((s) => s.startDate <= day && day <= s.endDate);
			if (current && current.startDate !== current.endDate) {
				const { dayNo, totalDays } = dayWindowInfo(current.startDate, current.endDate, day);
				stay = {
					place: current.place,
					startDate: current.startDate,
					endDate: current.endDate,
					dayNo,
					totalDays
				};
			}
		} catch (err) {
			console.warn('computeStaysFromDayPlans failed:', err);
		}
	}

	const movement: DayMovement[] = [];
	for (const i of topItems) {
		const m = movementFromItem(i);
		if (m) movement.push(m);
	}

	return { date: day, locations, stay, movement };
}

/**
 * Bygg ett strukturert reisesegment fra et sjekklistepunkt, eller null hvis
 * punktet ikke er en reise. Ren funksjon (ingen DB/nett) så den kan testes
 * direkte. Koordinat og ankomstfrist tas fra pinnet metadata når de finnes —
 * begge koordinater eller ingen, slik Ekko-kontrakten krever.
 */
export function movementFromItem(item: DayItem): DayMovement | null {
	const mode = getTravelMode(item);
	if (!mode) return null;
	const md = item.metadata;
	const time =
		md?.timeHour !== undefined ? formatItemTime(md.timeHour, md.timeMinute ?? 0) : null;
	const movement: DayMovement = { mode, destination: md?.destination, time };
	// Koordinat: pinnet ved oppretting. Send begge eller ingen (Ekko gir nil ved kun ett).
	if (typeof md?.lat === 'number' && typeof md?.lon === 'number') {
		movement.destLat = md.lat;
		movement.destLon = md.lon;
	}
	// Ankomstfrist: kun når en eksplisitt «innen»-frist er satt på segmentet.
	if (md?.arriveByHour !== undefined) {
		movement.arriveBy = formatItemTime(md.arriveByHour, md.arriveByMinute ?? 0);
	}
	return movement;
}

/** Formater strukturert dagskontekst til prosa-blokken chat-prompten bruker. */
export function formatDayContextBlock(ctx: DayContext): string {
	if (ctx.locations.length === 0 && ctx.movement.length === 0) return '';

	const lines: string[] = [];
	if (ctx.stay) {
		lines.push(
			`Opphold i ${ctx.stay.place} ${formatStayRange(ctx.stay)} (dag ${ctx.stay.dayNo} av ${ctx.stay.totalDays}).`
		);
	} else if (ctx.locations.length > 0) {
		lines.push(`Sted i dag: ${ctx.locations.join(', ')}.`);
	}
	for (const t of ctx.movement) {
		const label = travelModeLabel(t.mode).toLowerCase();
		const dest = t.destination ? ` til ${t.destination}` : '';
		const time = t.time ? ` kl. ${t.time}` : '';
		const deadline = t.arriveBy ? ` (innen kl. ${t.arriveBy})` : '';
		lines.push(`Reise i dag: ${label}${dest}${time}${deadline}.`);
	}

	return `\n--- DAGENS STED ---\n${lines.join('\n')}\nBruk dette til stedstilpasset kontekst (vær, reisetid, lokale forslag) når det er relevant.\n--- SLUTT PÅ STED ---\n`;
}

/**
 * Returnerer en formatert kontekst-blokk for dagens sted/reise, eller tom
 * streng hvis dagen ikke har noe sted-/reise-punkt. `timezone` kan sendes inn
 * for å unngå et ekstra DB-oppslag når kalleren allerede har den.
 */
export async function buildDayContextBlock(userId: string, timezone?: string): Promise<string> {
	const ctx = await gatherDayContext(userId, undefined, timezone);
	return formatDayContextBlock(ctx);
}
