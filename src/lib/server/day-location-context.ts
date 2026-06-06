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
	} | null;
}

/**
 * Returnerer en formatert kontekst-blokk for dagens sted/reise, eller tom
 * streng hvis dagen ikke har noe sted-/reise-punkt. `timezone` kan sendes inn
 * for å unngå et ekstra DB-oppslag når kalleren allerede har den.
 */
export async function buildDayContextBlock(userId: string, timezone?: string): Promise<string> {
	let tz = timezone;
	if (!tz) {
		const user = await db.query.users.findFirst({
			where: eq(users.id, userId),
			columns: { timezone: true }
		});
		tz = user?.timezone ?? 'Europe/Oslo';
	}

	const todayIso = localIsoDay(tz, new Date());
	const ctx = dayContextForDate(todayIso);

	const checklist = await db.query.checklists.findFirst({
		where: and(eq(checklists.userId, userId), eq(checklists.context, ctx)),
		with: { items: true }
	});
	if (!checklist?.items?.length) return '';

	const topItems = (checklist.items as DayItem[]).filter((i) => !i.parentId && !i.skippedAt);

	const locations = topItems.filter((i) => isLocationItem(i)).map((i) => locationDisplayName(i));

	// Opphold (Fase C): finn et evt. flerdagers opphold som dekker i dag, så
	// assistenten vet hvor lenge brukeren er borte («dag 2 av 3»), ikke bare i dag.
	let stayLine: string | null = null;
	if (locations.length > 0) {
		try {
			const stays = await computeStaysFromDayPlans(
				userId,
				addDaysIso(todayIso, -21),
				addDaysIso(todayIso, 45)
			);
			const current = stays.find((s) => s.startDate <= todayIso && todayIso <= s.endDate);
			if (current && current.startDate !== current.endDate) {
				const total = Math.round(
					(Date.parse(current.endDate) - Date.parse(current.startDate)) / 86400000
				) + 1;
				const dayNo = Math.round(
					(Date.parse(todayIso) - Date.parse(current.startDate)) / 86400000
				) + 1;
				stayLine = `Opphold i ${current.place} ${formatStayRange(current)} (dag ${dayNo} av ${total}).`;
			}
		} catch (err) {
			console.warn('computeStaysFromDayPlans failed:', err);
		}
	}

	const travels: Array<{ mode: 'drive' | 'boat' | 'flight'; dest?: string; time: string | null }> = [];
	for (const i of topItems) {
		const mode = getTravelMode(i);
		if (!mode) continue;
		const time =
			i.metadata?.timeHour !== undefined
				? formatItemTime(i.metadata.timeHour, i.metadata.timeMinute ?? 0)
				: null;
		travels.push({ mode, dest: i.metadata?.destination, time });
	}

	if (locations.length === 0 && travels.length === 0) return '';

	const lines: string[] = [];
	if (stayLine) {
		lines.push(stayLine);
	} else if (locations.length > 0) {
		lines.push(`Sted i dag: ${[...new Set(locations)].join(', ')}.`);
	}
	for (const t of travels) {
		const label = travelModeLabel(t.mode).toLowerCase();
		const dest = t.dest ? ` til ${t.dest}` : '';
		const time = t.time ? ` kl. ${t.time}` : '';
		lines.push(`Reise i dag: ${label}${dest}${time}.`);
	}

	return `\n--- DAGENS STED ---\n${lines.join('\n')}\nBruk dette til stedstilpasset kontekst (vær, reisetid, lokale forslag) når det er relevant.\n--- SLUTT PÅ STED ---\n`;
}
