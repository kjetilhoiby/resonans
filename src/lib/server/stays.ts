/**
 * stays.ts — utled opphold fra dagsplanene.
 *
 * Leser «Sted: X»-punkter på tvers av dag-sjekklister i et datovindu og slår
 * sammen sammenhengende dager med samme sted til opphold (Fase C). Brukt av
 * chat-kontekst og av import-til-reiseplan-endepunktet. Leser kun.
 */

import { db } from '$lib/db';
import { checklists } from '$lib/db/schema';
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
	metadata?: { kind?: string; locationName?: string } | null;
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
		if (locItem) entries.push({ date, place: locationDisplayName(locItem) });
	}

	return aggregateStays(entries);
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
