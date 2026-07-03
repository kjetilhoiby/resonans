/**
 * day-origin.ts — dagens fra-punkt (origin) for /api/apps/day.
 *
 * Ekko trenger å vite hvor dagen STARTER, ikke bare hvor den skal ende. Origin
 * utledes deklarert der planen gir det, med bilens sist observerte posisjon som
 * fallback:
 *
 *   1. Opphold som dekker i dag men startet tidligere → brukeren våknet der.
 *   2. Gårsdagens siste reisesegment med destinasjon → dagen endte der.
 *   3. Opphold som dekket gårsdagen.
 *   4. Fallback: sist lagrede drive_state-posisjon FØR dagen startet
 *      (source = 'observed'; stedsnavn utelates — vi reverse-geokoder ikke).
 *
 * Rene funksjoner øverst (testbare uten DB), tynn loader nederst.
 */

import { db } from '$lib/db';
import { sensorEvents, users } from '$lib/db/schema';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { LocationStay } from '$lib/utils/checklist-group';
import { addDaysIso } from './iso-week';
import { localDayUtcRange, localIsoDay } from './nudge-time';
import { computeStaysFromDayPlans } from './stays';
import { gatherDayContext, type DayMovement } from './day-location-context';
import { getTeslaSensor } from './integrations/tesla-sync';

export interface DayOrigin {
	/** Stedsnavn. Utelatt for observert posisjon (ingen reverse-geokoding). */
	place?: string;
	/** Koordinat — begge eller ingen. */
	lat?: number;
	lon?: number;
	source: 'declared' | 'observed';
	/** ISO-dato brukeren (antatt) har vært på stedet siden. */
	fromDate?: string;
}

/** Kopier lat/lon fra en kilde kun når begge finnes (Ekko-kontrakten). */
function coordsFrom(src: { lat?: number; lon?: number }): { lat?: number; lon?: number } {
	return typeof src.lat === 'number' && typeof src.lon === 'number'
		? { lat: src.lat, lon: src.lon }
		: {};
}

/**
 * Utled dagens deklarerte origin fra opphold og gårsdagens reisesegmenter.
 * Ren funksjon — se modulkommentaren for presedensen. Returnerer null når
 * planen ikke sier noe (kalleren faller tilbake til observert posisjon).
 */
export function resolveDeclaredOrigin(
	day: string,
	stays: LocationStay[],
	prevDayMovement: DayMovement[]
): DayOrigin | null {
	const prevDay = addDaysIso(day, -1);

	// 1) Opphold som dekker i dag og startet før i dag — brukeren våknet der.
	const current = stays.find((s) => s.startDate < day && day <= s.endDate);
	if (current) {
		return { place: current.place, ...coordsFrom(current), source: 'declared', fromDate: current.startDate };
	}

	// 2) Gårsdagens siste reisesegment med destinasjon — dagen endte der.
	const lastMove = [...prevDayMovement].reverse().find((m) => m.destination);
	if (lastMove) {
		return {
			place: lastMove.destination,
			...coordsFrom({ lat: lastMove.destLat, lon: lastMove.destLon }),
			source: 'declared',
			fromDate: prevDay
		};
	}

	// 3) Opphold som dekket gårsdagen (uten å strekke seg inn i dag).
	const yesterday = stays.find((s) => s.startDate <= prevDay && prevDay <= s.endDate);
	if (yesterday) {
		return {
			place: yesterday.place,
			...coordsFrom(yesterday),
			source: 'declared',
			fromDate: yesterday.startDate
		};
	}

	return null;
}

/**
 * Beriker reisesegmentene med fra-punkt: etappe 1 arver dagens origin, etappe
 * N>1 får forrige etappes destinasjon (deklarert kjede). Ren funksjon —
 * muterer ikke input. Felt utelates når ukjent.
 */
export function enrichMovementWithOrigins(
	movement: DayMovement[],
	dayOrigin: DayOrigin | null
): DayMovement[] {
	return movement.map((seg, i) => {
		const out: DayMovement = { ...seg };
		if (i === 0) {
			if (dayOrigin) {
				if (dayOrigin.place !== undefined) out.origin = dayOrigin.place;
				if (dayOrigin.lat !== undefined && dayOrigin.lon !== undefined) {
					out.originLat = dayOrigin.lat;
					out.originLon = dayOrigin.lon;
				}
				if (out.origin !== undefined || out.originLat !== undefined) {
					out.originSource = dayOrigin.source;
				}
			}
		} else {
			const prev = movement[i - 1];
			if (prev.destination !== undefined) out.origin = prev.destination;
			if (prev.destLat !== undefined && prev.destLon !== undefined) {
				out.originLat = prev.destLat;
				out.originLon = prev.destLon;
			}
			if (out.origin !== undefined || out.originLat !== undefined) {
				out.originSource = 'declared';
			}
		}
		return out;
	});
}

/**
 * Hent dagens origin for en bruker: deklarert fra planen når mulig, ellers
 * sist observerte bilposisjon før dagen startet. Null når ingenting er kjent.
 */
export async function loadDayOrigin(userId: string, day: string): Promise<DayOrigin | null> {
	const user = await db.query.users.findFirst({
		where: eq(users.id, userId),
		columns: { timezone: true }
	});
	const tz = user?.timezone ?? 'Europe/Oslo';

	const [stays, prevCtx] = await Promise.all([
		computeStaysFromDayPlans(userId, addDaysIso(day, -21), day),
		gatherDayContext(userId, addDaysIso(day, -1), tz)
	]);
	const declared = resolveDeclaredOrigin(day, stays, prevCtx.movement);
	if (declared) return declared;

	// Fallback: sist lagrede drive_state-posisjon før den lokale dagen startet.
	const sensor = await getTeslaSensor(userId);
	if (!sensor) return null;

	const { start } = localDayUtcRange(day, tz);
	const rows = await db
		.select({
			timestamp: sensorEvents.timestamp,
			lat: sql<number>`(data->>'lat')::numeric`,
			lon: sql<number>`(data->>'lon')::numeric`
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.sensorId, sensor.id),
				eq(sensorEvents.dataType, 'drive_state'),
				sql`data ? 'lat'`,
				sql`data ? 'lon'`,
				lt(sensorEvents.timestamp, start)
			)
		)
		.orderBy(desc(sensorEvents.timestamp))
		.limit(1);

	const row = rows[0];
	if (!row) return null;
	const lat = Number(row.lat);
	const lon = Number(row.lon);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

	return { lat, lon, source: 'observed', fromDate: localIsoDay(tz, row.timestamp) };
}
