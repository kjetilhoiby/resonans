/**
 * Server-side lasting av en gåtur (Ekko-tur) for 3D-avspilling og import til
 * kartfortelling. En tur ligger som et workout-event i sensor_events (spor i
 * `data.trackPoints`); vedlagte bilder er egne image-events som deler turens
 * `sessionId` i metadata. Denne modulen samler dem og bygger avspillings-data
 * via den rene logikken i `$lib/components/domain/walk-playback`.
 */

import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import {
	buildWalkPlayback,
	type WalkImage,
	type WalkTrackPoint,
	type WalkPlayback,
	type WalkStats
} from '$lib/components/domain/walk-playback';
import { describeWorkoutSportType } from './workout-taxonomy';

export interface WalkData {
	eventId: string;
	sportType: string | null;
	title: string;
	/** Når turen startet (event-tidspunkt). */
	startedAt: Date;
	track: WalkTrackPoint[];
	images: WalkImage[];
	storedStats: Partial<WalkStats>;
	/** Foretrukket kartlag valgt ved deling ('topo' | 'sat'), ellers null. */
	preferredBasemap: string | null;
}

export interface WalkPlaybackResult {
	eventId: string;
	title: string;
	sportType: string | null;
	startedAt: string;
	imageCount: number;
	playback: WalkPlayback;
	/** Foretrukket kartlag valgt ved deling ('topo' | 'sat'), ellers null. */
	basemap: string | null;
}

function toNum(v: unknown): number | null {
	return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Henter turens spor, vedlagte bilder og lagrede nøkkeltall fra sensor_events. */
export async function fetchWalkData(userId: string, walkEventId: string): Promise<WalkData | null> {
	const event = await db.query.sensorEvents.findFirst({
		where: and(
			eq(sensorEvents.id, walkEventId),
			eq(sensorEvents.userId, userId),
			eq(sensorEvents.dataType, 'workout')
		),
		columns: { id: true, data: true, metadata: true, timestamp: true }
	});
	if (!event) return null;

	const data = (event.data ?? {}) as Record<string, unknown>;
	const meta = (event.metadata ?? {}) as Record<string, unknown>;

	const rawTrack = Array.isArray(data.trackPoints) ? (data.trackPoints as Array<Record<string, unknown>>) : [];
	const track: WalkTrackPoint[] = [];
	for (const p of rawTrack) {
		const lat = toNum(p.lat);
		const lon = toNum(p.lon);
		if (lat === null || lon === null) continue;
		track.push({
			lat,
			lon,
			ele: toNum(p.ele),
			hr: toNum(p.hr),
			time: typeof p.time === 'string' ? p.time : null
		});
	}

	// Vedlagte bilder: image-events som deler turens sessionId. Sorteres
	// kronologisk (etter capturedAt, ellers opplastingstid) så jevn-fordelingen
	// i placeImagesOnTrack får riktig rekkefølge når posisjon mangler.
	const sessionId = typeof meta.sessionId === 'string' ? meta.sessionId : null;
	let images: WalkImage[] = [];
	if (sessionId) {
		const rows = await db.query.sensorEvents.findMany({
			where: and(
				eq(sensorEvents.userId, userId),
				sql`${sensorEvents.metadata}->>'sessionId' = ${sessionId}`
			),
			columns: { id: true, data: true, timestamp: true }
		});
		const collected: Array<WalkImage & { sortKey: number }> = [];
		for (const r of rows) {
			if (r.id === event.id) continue;
			const d = (r.data ?? {}) as Record<string, unknown>;
			const url = typeof d.imageUrl === 'string' ? d.imageUrl : null;
			if (!url) continue;
			const capturedAt = typeof d.capturedAt === 'string' ? d.capturedAt : null;
			const parsed = capturedAt ? Date.parse(capturedAt) : NaN;
			collected.push({
				url,
				caption: typeof d.caption === 'string' ? d.caption : null,
				capturedAt,
				lat: toNum(d.lat),
				lon: toNum(d.lon),
				sortKey: Number.isFinite(parsed) ? parsed : r.timestamp.getTime()
			});
		}
		collected.sort((a, b) => a.sortKey - b.sortKey);
		images = collected.map(({ sortKey: _sortKey, ...img }) => img);
	}

	const storedStats: Partial<WalkStats> = {};
	if (toNum(data.distance) !== null) storedStats.distanceMeters = Math.round(data.distance as number);
	if (toNum(data.duration) !== null) storedStats.durationSeconds = Math.round(data.duration as number);
	if (toNum(data.elevation) !== null) storedStats.ascentMeters = Math.round(data.elevation as number);

	const sportType = typeof data.sportType === 'string' ? data.sportType : null;
	const preferredBasemap =
		data.preferredBasemap === 'topo' || data.preferredBasemap === 'sat'
			? (data.preferredBasemap as string)
			: null;

	return {
		eventId: event.id,
		sportType,
		title: sportType ? describeWorkoutSportType(sportType) : 'Tur',
		startedAt: event.timestamp,
		track,
		images,
		storedStats,
		preferredBasemap
	};
}

/** Bygger komplett 3D-avspillings-data for en tur (til /share og data-endepunkt). */
export async function loadWalkPlayback(userId: string, walkEventId: string): Promise<WalkPlaybackResult | null> {
	const walk = await fetchWalkData(userId, walkEventId);
	if (!walk) return null;
	return {
		eventId: walk.eventId,
		title: walk.title,
		sportType: walk.sportType,
		startedAt: walk.startedAt.toISOString(),
		imageCount: walk.images.length,
		playback: buildWalkPlayback(walk.track, walk.images, walk.storedStats),
		basemap: walk.preferredBasemap
	};
}
