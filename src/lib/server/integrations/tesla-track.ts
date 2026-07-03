/**
 * tesla-track.ts — dagens posisjons-/ladelogg som tidsordnede punkt for Ekko.
 *
 * Slår sammen de tre lagrede Tesla-dataTypene (drive_state, charge_state,
 * vehicle_state) per poll-tidsstempel til ett punkt, og AVLEDER hendelses-
 * markører (park/depart/charge_start/charge_stop/wake) ved diff av påfølgende
 * punkt. Markørene er avledet, ikke observert: presisjonen er begrenset til
 * sampling-kadensen (cron hvert 15. min + Ekkos ?live=true-poll når cockpiten
 * er åpen). Hull i tidsserien betyr sovende bil — de fylles bevisst IKKE med
 * interpolerte punkt; Ekko utleder dvele fra ts-differansene selv.
 *
 * Rene funksjoner øverst (testbare uten DB), tynn loader nederst. Leser kun
 * lagret logg — vekker aldri bilen.
 */

import { db } from '$lib/db';
import { sensorEvents, users } from '$lib/db/schema';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { isoWithTzOffset, localDayUtcRange, localIsoDay } from '$lib/server/nudge-time';
import { getTeslaSensor } from './tesla-sync';

export type TrackEventKind = 'park' | 'depart' | 'charge_start' | 'charge_stop' | 'wake';

/**
 * Tidsgap som markerer neste punkt som `wake` (første sample etter søvn).
 * 2× cron-kadensen: ett enkelt bomskudd (transient feil) skal ikke telle.
 */
export const WAKE_GAP_MS = 30 * 60_000;

/** Ett punkt i Ekko-kontrakten. `ts` er ISO-8601 med offset i brukerens tidssone. */
export interface TrackPoint {
	ts: string;
	lat: number;
	lon: number;
	speedKmh?: number;
	/** P|D|R|N eller null (parkert/idle). Utelatt når drive_state manglet. */
	shiftState?: string | null;
	charging?: boolean;
	batteryPercent?: number;
	odometerKm?: number;
	/** Avledet markør på et eksisterende punkt — se deriveTrackEvent. */
	event?: TrackEventKind;
}

/** Rå sensor-event-rad slik loaderen leser den fra sensor_events. */
export interface TrackEventRow {
	dataType: string;
	timestamp: Date;
	data: Record<string, unknown> | null;
}

/**
 * Internt sammenslått sample per poll-tidsstempel.
 * `shiftState === undefined` betyr at drive_state manglet i pollen (skilles fra
 * eksplisitt `null` = parkert/idle, som Tesla rapporterer).
 */
export interface TrackSample {
	tsMs: number;
	lat?: number;
	lon?: number;
	speedKmh?: number;
	shiftState?: string | null;
	charging?: boolean;
	batteryPercent?: number;
	odometerKm?: number;
}

function num(v: unknown): number | undefined {
	return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Grupper rå sensor-events per tidsstempel og slå sammen feltene fra de tre
 * dataTypene til ett sample. Én poll skriver alle tre med samme timestamp, så
 * gruppering på eksakt tid rekonstruerer poll-øyeblikkene. Kronologisk sortert.
 */
export function mergeTrackSamples(rows: TrackEventRow[]): TrackSample[] {
	const byTs = new Map<number, TrackSample>();
	for (const row of rows) {
		const tsMs = row.timestamp.getTime();
		if (!Number.isFinite(tsMs)) continue;
		const data = row.data ?? {};
		let sample = byTs.get(tsMs);
		if (!sample) {
			sample = { tsMs };
			byTs.set(tsMs, sample);
		}
		if (row.dataType === 'drive_state') {
			sample.lat = num(data.lat);
			sample.lon = num(data.lon);
			sample.speedKmh = num(data.speedKmh);
			sample.shiftState = typeof data.shiftState === 'string' ? data.shiftState : null;
		} else if (row.dataType === 'charge_state') {
			if (typeof data.charging === 'boolean') sample.charging = data.charging;
			sample.batteryPercent = num(data.batteryPercent);
		} else if (row.dataType === 'vehicle_state') {
			sample.odometerKm = num(data.odometerKm);
		}
	}
	return [...byTs.values()].sort((a, b) => a.tsMs - b.tsMs);
}

const MOVING_SHIFT_STATES = new Set(['D', 'R', 'N']);

function isMoving(shift: string | null | undefined): boolean {
	return typeof shift === 'string' && MOVING_SHIFT_STATES.has(shift);
}

function isParked(shift: string | null | undefined): boolean {
	return shift === null || shift === 'P';
}

/**
 * Avled hendelsesmarkør for `cur` gitt forrige sample. Ett punkt får maks én
 * markør; prioritet ved sammenfall: charge_start > charge_stop > park > depart
 * > wake (ladeovergangen navngir stopptypen og er mest informativ for
 * segmentering; wake er bare et gap-signal).
 */
export function deriveTrackEvent(
	prev: TrackSample | undefined,
	cur: TrackSample
): TrackEventKind | undefined {
	if (!prev) return undefined;
	if (prev.charging === false && cur.charging === true) return 'charge_start';
	if (prev.charging === true && cur.charging === false) return 'charge_stop';
	if (isMoving(prev.shiftState) && isParked(cur.shiftState)) return 'park';
	if (isParked(prev.shiftState) && isMoving(cur.shiftState)) return 'depart';
	if (cur.tsMs - prev.tsMs >= WAKE_GAP_MS) return 'wake';
	return undefined;
}

/**
 * Bygg Ekko-punktene fra sammenslåtte samples. Samples uten koordinat (sjeldent:
 * bilen våken men uten GPS-fix) arver forrige kjente posisjon — bilen har ikke
 * flyttet seg når drive_state mangler. Samples før første kjente posisjon
 * droppes. Hendelser avledes over HELE sample-sekvensen (også droppede), så en
 * overgang aldri forsvinner fordi nabopunktet manglet GPS.
 */
export function buildTrackPoints(samples: TrackSample[], timeZone: string): TrackPoint[] {
	const points: TrackPoint[] = [];
	let lastLat: number | undefined;
	let lastLon: number | undefined;

	for (let i = 0; i < samples.length; i++) {
		const s = samples[i];
		if (s.lat !== undefined && s.lon !== undefined) {
			lastLat = s.lat;
			lastLon = s.lon;
		}
		if (lastLat === undefined || lastLon === undefined) continue;

		const point: TrackPoint = {
			ts: isoWithTzOffset(new Date(s.tsMs), timeZone),
			lat: lastLat,
			lon: lastLon
		};
		if (s.speedKmh !== undefined) point.speedKmh = s.speedKmh;
		if (s.shiftState !== undefined) point.shiftState = s.shiftState;
		if (s.charging !== undefined) point.charging = s.charging;
		if (s.batteryPercent !== undefined) point.batteryPercent = s.batteryPercent;
		if (s.odometerKm !== undefined) point.odometerKm = s.odometerKm;

		const event = deriveTrackEvent(samples[i - 1], s);
		if (event) point.event = event;

		points.push(point);
	}
	return points;
}

export interface DayTrack {
	date: string; // ISO 'YYYY-MM-DD' i brukerens tidssone
	points: TrackPoint[];
}

/**
 * Hent dagens spor for en bruker. `date` default = i dag i brukerens tidssone.
 * Ingen sensor eller ingen data for dagen → tom `points` (aldri feil for det).
 */
export async function loadDayTrack(userId: string, date?: string): Promise<DayTrack> {
	const user = await db.query.users.findFirst({
		where: eq(users.id, userId),
		columns: { timezone: true }
	});
	const tz = user?.timezone ?? 'Europe/Oslo';
	const day = date ?? localIsoDay(tz, new Date());

	const sensor = await getTeslaSensor(userId);
	if (!sensor) return { date: day, points: [] };

	const { start, end } = localDayUtcRange(day, tz);
	const rows = await db
		.select({
			dataType: sensorEvents.dataType,
			timestamp: sensorEvents.timestamp,
			data: sensorEvents.data
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.sensorId, sensor.id),
				inArray(sensorEvents.dataType, ['drive_state', 'charge_state', 'vehicle_state']),
				gte(sensorEvents.timestamp, start),
				lt(sensorEvents.timestamp, end)
			)
		)
		.orderBy(asc(sensorEvents.timestamp));

	const samples = mergeTrackSamples(
		rows.map((r) => ({
			dataType: r.dataType ?? '',
			timestamp: r.timestamp,
			data: (r.data ?? null) as Record<string, unknown> | null
		}))
	);
	return { date: day, points: buildTrackPoints(samples, tz) };
}
