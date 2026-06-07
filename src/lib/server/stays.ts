/**
 * stays.ts — utled opphold fra dagsplanene.
 *
 * Leser «Sted: X»-punkter på tvers av dag-sjekklister i et datovindu og slår
 * sammen sammenhengende dager med samme sted til opphold (Fase C). Brukt av
 * chat-kontekst og av import-til-reiseplan-endepunktet. Leser kun.
 */

import { db } from '$lib/db';
import { checklists, themes } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { dayContextForDate, addDaysIso } from './iso-week';
import {
	aggregateStays,
	isLocationItem,
	locationDisplayName,
	type LocationStay,
	type DayLocationEntry
} from '$lib/utils/checklist-group';

interface ChecklistItemRow {
	parentId?: string | null;
	text: string;
	metadata?: { kind?: string; locationName?: string; lat?: number; lon?: number } | null;
}

/** Alle ISO-datoer i [startIso, endIso] (inklusive). Begrenset til maxDays for sikkerhet. */
function datesInRange(startIso: string, endIso: string, maxDays = 120): string[] {
	const dates: string[] = [];
	let cur = startIso;
	for (let i = 0; i < maxDays && cur <= endIso; i++) {
		dates.push(cur);
		cur = addDaysIso(cur, 1);
	}
	return dates;
}

/**
 * Hent opphold utledet fra dagsplanene i datovinduet [startIso, endIso].
 * For hver dag tas det første sted-punktet (om flere) som dagens sted.
 */
export async function computeStaysFromDayPlans(
	userId: string,
	startIso: string,
	endIso: string
): Promise<LocationStay[]> {
	if (!startIso || !endIso || startIso > endIso) return [];

	const dates = datesInRange(startIso, endIso);
	const contexts = dates.map(dayContextForDate);
	const contextToDate = new Map(contexts.map((c, i) => [c, dates[i]]));

	const rows = await db.query.checklists.findMany({
		where: and(eq(checklists.userId, userId), inArray(checklists.context, contexts)),
		with: { items: true }
	});

	const entries: DayLocationEntry[] = [];
	for (const cl of rows) {
		const date = cl.context ? contextToDate.get(cl.context) : undefined;
		if (!date) continue;
		const items = (cl.items ?? []) as ChecklistItemRow[];
		const locItem = items.find((i) => !i.parentId && isLocationItem(i));
		if (locItem) {
			entries.push({
				date,
				place: locationDisplayName(locItem),
				lat: locItem.metadata?.lat,
				lon: locItem.metadata?.lon
			});
		}
	}

	return aggregateStays(entries);
}

// ── Automatisk skriving av opphold til reise-/ferieplan ─────────────────────
//
// Når et «Sted:»-punkt opprettes på en dato, oppdaterer vi oppholdet i planen
// som dekker datoen — uten brukerhandling. Opphold som er utledet fra dagsplanen
// merkes med `source: 'dayplan'` og rekonsileres ved hver kjøring (vokser/krymper
// med datoene), mens manuelt opprettede opphold beholdes urørt.

type ThemeRow = typeof themes.$inferSelect;
type TripProfileShape = NonNullable<ThemeRow['tripProfile']>;
type FerieProfileShape = NonNullable<ThemeRow['ferieProfile']>;
type TripStay = NonNullable<TripProfileShape['overnightStays']>[number];
type FerieStop = NonNullable<NonNullable<FerieProfileShape['trips']>[number]['stops']>[number];

const DAYPLAN_SOURCE = 'dayplan';

function tripStaysSignature(list: TripStay[]): string {
	return list
		.map((s) => `${s.name.toLowerCase()}|${s.checkIn}|${s.checkOut}`)
		.sort()
		.join('~');
}
function ferieStopsSignature(list: FerieStop[]): string {
	return list
		.map((s) => `${s.place.toLowerCase()}|${s.startDate}|${s.endDate}`)
		.sort()
		.join('~');
}

/**
 * Skriv utledede opphold automatisk inn i reise-/ferieplanen som dekker `dateIso`.
 * Idempotent og selv-korrigerende: rekomputerer hele vinduet og rekonsilerer
 * dayplan-oppholdene. Kalles fire-and-forget ved oppretting av et sted-punkt.
 */
export async function syncStaysForDate(userId: string, dateIso: string): Promise<void> {
	if (!userId || !dateIso) return;

	const rows = await db.query.themes.findMany({
		where: eq(themes.userId, userId),
		columns: { id: true, tripProfile: true, ferieProfile: true }
	});

	for (const t of rows) {
		const trip = t.tripProfile as TripProfileShape | null;
		if (trip?.startDate && trip?.endDate && trip.startDate <= dateIso && dateIso <= trip.endDate) {
			await reconcileTripStays(t.id, userId, trip);
			continue;
		}
		const ferie = t.ferieProfile as FerieProfileShape | null;
		const block = ferie?.trips?.find(
			(b) => b.startDate && b.endDate && b.startDate <= dateIso && dateIso <= b.endDate
		);
		if (ferie && block) {
			await reconcileFerieBlockStays(t.id, userId, ferie, block.id);
		}
	}
}

async function reconcileTripStays(themeId: string, userId: string, trip: TripProfileShape): Promise<void> {
	const stays = await computeStaysFromDayPlans(userId, trip.startDate!, trip.endDate!);
	const auto: TripStay[] = stays.map((s) => ({
		id: crypto.randomUUID(),
		name: s.place,
		checkIn: s.startDate,
		checkOut: s.endDate,
		source: DAYPLAN_SOURCE
	}));

	const all = trip.overnightStays ?? [];
	const prevAuto = all.filter((s) => s.source === DAYPLAN_SOURCE);
	if (tripStaysSignature(prevAuto) === tripStaysSignature(auto)) return; // ingen endring

	const manual = all.filter((s) => s.source !== DAYPLAN_SOURCE);
	const merged: TripProfileShape = { ...trip, overnightStays: [...manual, ...auto] };
	await db
		.update(themes)
		.set({ tripProfile: merged, updatedAt: new Date() })
		.where(and(eq(themes.id, themeId), eq(themes.userId, userId)));
}

async function reconcileFerieBlockStays(
	themeId: string,
	userId: string,
	ferie: FerieProfileShape,
	blockId: string
): Promise<void> {
	const block = ferie.trips?.find((b) => b.id === blockId);
	if (!block?.startDate || !block?.endDate) return;

	const stays = await computeStaysFromDayPlans(userId, block.startDate, block.endDate);
	const auto: FerieStop[] = stays.map((s) => ({
		id: crypto.randomUUID(),
		place: s.place,
		startDate: s.startDate,
		endDate: s.endDate,
		...(s.lat != null && { lat: s.lat, lon: s.lon }),
		source: DAYPLAN_SOURCE
	}));

	const all = block.stops ?? [];
	const prevAuto = all.filter((s) => s.source === DAYPLAN_SOURCE);
	if (ferieStopsSignature(prevAuto) === ferieStopsSignature(auto)) return;

	const manual = all.filter((s) => s.source !== DAYPLAN_SOURCE);
	const nextStops = [...manual, ...auto];
	const nextTrips = (ferie.trips ?? []).map((b) => (b.id === blockId ? { ...b, stops: nextStops } : b));
	const merged: FerieProfileShape = { ...ferie, trips: nextTrips };
	await db
		.update(themes)
		.set({ ferieProfile: merged, updatedAt: new Date() })
		.where(and(eq(themes.id, themeId), eq(themes.userId, userId)));
}

/** Norsk datospenn for et opphold, f.eks. «6.–8. juni» eller «6. juni» (én dag). */
export function formatStayRange(stay: LocationStay): string {
	const fmt = (iso: string, withMonth: boolean) => {
		const d = new Date(iso + 'T12:00:00');
		return withMonth
			? new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long' }).format(d)
			: new Intl.DateTimeFormat('nb-NO', { day: 'numeric' }).format(d);
	};
	if (stay.startDate === stay.endDate) return fmt(stay.startDate, true);
	const sameMonth = stay.startDate.slice(0, 7) === stay.endDate.slice(0, 7);
	return `${fmt(stay.startDate, !sameMonth)}–${fmt(stay.endDate, true)}`;
}
