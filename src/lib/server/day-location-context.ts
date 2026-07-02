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
import { dayWindowInfo, type GeoSource } from './trip-geo';
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
	/**
	 * Utledet startpunkt for etappen: dagens origin for første etappe, ellers
	 * forrige etappes destinasjon (kjedet reise). Utelatt når vi ikke vet hvor
	 * etappen starter.
	 */
	origin?: string;
	/** Koordinat for startpunktet. Sendes alltid sammen — begge eller ingen. */
	originLat?: number;
	originLon?: number;
}

/**
 * Utledet startpunkt for dagen: hvor brukeren begynner dagen, brukt som origin
 * for første reisesegment. Utledes av dagens eget «Sted:» eller — når dagen ikke
 * har et basested — fra siste kjente sted/reisemål de foregående dagene.
 */
export interface DayOrigin {
	place: string;
	lat?: number;
	lon?: number;
	source: GeoSource; // 'declared' for planlagte «Sted:»/«kjøre til»-punkter
	fromDate: string; // ISO-dagen signalet ble hentet fra (i dag eller en tidligere dag)
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
	movement: DayMovement[]; // reisesegmenter (kjøre/båt/fly), kronologisk og kjedet
	origin: DayOrigin | null; // utledet startpunkt for dagen (origin for første etappe)
}

/** Hvor langt tilbake vi leter etter et startpunkt når dagen selv mangler basested. */
const ORIGIN_LOOKBACK_DAYS = 3;

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
	const empty: DayContext = { date: day, locations: [], stay: null, movement: [], origin: null };

	const plan = await readDayPlan(userId, day);
	if (!plan) return empty;
	const { locations, baseLocation, movement: rawMovement } = plan;

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

	// Startpunkt: dagens eget basested vinner (der du våkner). Har ikke dagen et
	// «Sted:», men det er en reise, leter vi bakover etter siste kjente sted —
	// enten et «Sted:» eller destinasjonen for siste «kjøre til» de dagene før.
	let origin: DayOrigin | null = null;
	if (baseLocation) {
		origin = { ...baseLocation, source: 'declared', fromDate: day };
	} else if (rawMovement.length > 0) {
		origin = await inferPriorDayOrigin(userId, day);
	}

	// Kjed etappene: origin → etappe 1 → etappe 2 … slik at et mellomstopp
	// («kjøre til Hamar», så «kjøre til Dovre») blir én sammensatt reise.
	const movement = chainMovementOrigins(rawMovement, origin);

	return { date: day, locations, stay, movement, origin };
}

/** Utdrag fra én dags sjekkliste: steder, basested (første «Sted:») og reisesegmenter. */
interface DayPlanRead {
	locations: string[];
	baseLocation: { place: string; lat?: number; lon?: number } | null;
	movement: DayMovement[];
}

/**
 * Les én dags sjekkliste og trekk ut sted-/reise-strukturen. Delt mellom dagens
 * kontekst og startpunkt-utledningen for tidligere dager. Returnerer null når
 * dagen ikke har noen sjekkliste. Reisesegmentene sorteres kronologisk.
 */
async function readDayPlan(userId: string, day: string): Promise<DayPlanRead | null> {
	const ctx = dayContextForDate(day);
	const checklist = await db.query.checklists.findFirst({
		where: and(eq(checklists.userId, userId), eq(checklists.context, ctx)),
		with: { items: true }
	});
	if (!checklist?.items?.length) return null;

	const topItems = (checklist.items as DayItem[]).filter((i) => !i.parentId && !i.skippedAt);

	const locationItems = topItems.filter((i) => isLocationItem(i));
	const locations = [...new Set(locationItems.map((i) => locationDisplayName(i)))];

	const baseItem = locationItems[0];
	const baseLocation = baseItem
		? {
				place: locationDisplayName(baseItem),
				...coordsOf(baseItem.metadata)
			}
		: null;

	const movement = sortMovementByTime(
		topItems.map((i) => movementFromItem(i)).filter((m): m is DayMovement => m !== null)
	);

	return { locations, baseLocation, movement };
}

/** Plukk ut lat/lon fra metadata kun når begge finnes (koordinater sendes parvis). */
function coordsOf(md: DayItem['metadata']): { lat?: number; lon?: number } {
	if (typeof md?.lat === 'number' && typeof md?.lon === 'number') return { lat: md.lat, lon: md.lon };
	return {};
}

/**
 * Utled dagens startpunkt fra de foregående dagene når dagen selv mangler et
 * basested. For hver dag bakover (opp til ORIGIN_LOOKBACK_DAYS) er «hvor du
 * endte» destinasjonen for siste reisesegment, ellers dagens «Sted:». Første
 * treff vinner. Leser kun.
 */
async function inferPriorDayOrigin(userId: string, day: string): Promise<DayOrigin | null> {
	for (let back = 1; back <= ORIGIN_LOOKBACK_DAYS; back++) {
		const d = addDaysIso(day, -back);
		let plan: DayPlanRead | null;
		try {
			plan = await readDayPlan(userId, d);
		} catch (err) {
			console.warn('readDayPlan (origin) failed:', err);
			return null;
		}
		if (!plan) continue;

		// Siste reisemål den dagen er ferskere enn basestedet (du kjørte videre etterpå).
		const lastTravel = [...plan.movement].reverse().find((m) => m.destination);
		if (lastTravel?.destination) {
			return {
				place: lastTravel.destination,
				...(typeof lastTravel.destLat === 'number' && typeof lastTravel.destLon === 'number'
					? { lat: lastTravel.destLat, lon: lastTravel.destLon }
					: {}),
				source: 'declared',
				fromDate: d
			};
		}
		if (plan.baseLocation) {
			return { ...plan.baseLocation, source: 'declared', fromDate: d };
		}
	}
	return null;
}

/**
 * Sorter reisesegmenter kronologisk etter avgangstid. Segmenter uten tid legges
 * sist, med ellers bevart rekkefølge (stabil sort). Ren funksjon.
 */
export function sortMovementByTime(movement: DayMovement[]): DayMovement[] {
	return [...movement].sort((a, b) => {
		if (a.time === b.time) return 0;
		if (a.time === null) return 1;
		if (b.time === null) return -1;
		return a.time.localeCompare(b.time);
	});
}

/**
 * Kjed reisesegmentene til én sammenhengende reise: dagens origin er startpunkt
 * for første etappe, og hver påfølgende etappe starter der den forrige endte.
 * Slik blir «kjøre til Hamar» + «kjøre til Dovre» til start → Hamar (stopp) →
 * Dovre (destinasjon). Sorterer kronologisk først. Ren funksjon — muterer ikke
 * input.
 */
export function chainMovementOrigins(
	movement: DayMovement[],
	origin: DayOrigin | null
): DayMovement[] {
	const sorted = sortMovementByTime(movement);
	let prev: { place?: string; lat?: number; lon?: number } | null = origin
		? { place: origin.place, lat: origin.lat, lon: origin.lon }
		: null;
	return sorted.map((seg) => {
		const next: DayMovement = { ...seg };
		if (prev?.place) {
			next.origin = prev.place;
			if (typeof prev.lat === 'number' && typeof prev.lon === 'number') {
				next.originLat = prev.lat;
				next.originLon = prev.lon;
			}
		}
		prev = { place: seg.destination, lat: seg.destLat, lon: seg.destLon };
		return next;
	});
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
		// Vis «fra X» kun når startpunktet skiller seg fra destinasjonen (unngår støy).
		const from = t.origin && t.origin !== t.destination ? ` fra ${t.origin}` : '';
		const dest = t.destination ? ` til ${t.destination}` : '';
		const time = t.time ? ` kl. ${t.time}` : '';
		const deadline = t.arriveBy ? ` (innen kl. ${t.arriveBy})` : '';
		lines.push(`Reise i dag: ${label}${from}${dest}${time}${deadline}.`);
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
