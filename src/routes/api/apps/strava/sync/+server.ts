import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { getConnection, pushSession } from '$lib/server/services/strava-sync-service';
import { describeWorkoutSportType } from '$lib/server/workout-taxonomy';

/**
 * Manuell re-synk / backfill til Strava. Bearer-autentisert.
 *
 *   POST { "sessionId": "uuid" }   → re-pusher én lagret økt
 *   POST {}                        → backfiller siste N ikke-synkede økter
 *
 * Vi lagrer ikke rå GPX, men rekonstruerer en GPX fra de lagrede track-punktene
 * (lat/lon/ele/hr/time) på workout-eventet. pushSession er dedup-et, så allerede
 * synkede økter hoppes over.
 */

const BACKFILL_LIMIT = 10;

interface StoredTrackPoint {
	lat: number;
	lon: number;
	ele?: number;
	hr?: number;
	time?: string | number | Date;
}

function toIso(time: StoredTrackPoint['time']): string | null {
	if (time === undefined || time === null) return null;
	const d = time instanceof Date ? time : new Date(time);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function escapeXml(value: string): string {
	return value.replace(/[<>&'"]/g, (c) =>
		c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;'
	);
}

function buildGpx(points: StoredTrackPoint[], opts: { name: string; sportType?: string }): string {
	const trkpts = points
		.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
		.map((p) => {
			const parts = [`<trkpt lat="${p.lat}" lon="${p.lon}">`];
			if (typeof p.ele === 'number' && Number.isFinite(p.ele)) parts.push(`<ele>${p.ele}</ele>`);
			const iso = toIso(p.time);
			if (iso) parts.push(`<time>${iso}</time>`);
			if (typeof p.hr === 'number' && Number.isFinite(p.hr)) {
				parts.push(
					`<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${Math.round(p.hr)}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`
				);
			}
			parts.push('</trkpt>');
			return parts.join('');
		})
		.join('\n');

	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Resonans" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk>
    <name>${escapeXml(opts.name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

type WorkoutEvent = typeof sensorEvents.$inferSelect;

async function syncEvent(userId: string, appId: string, eventRow: WorkoutEvent): Promise<boolean> {
	const data = (eventRow.data ?? {}) as Record<string, unknown>;
	const metadata = (eventRow.metadata ?? {}) as Record<string, unknown>;
	const sessionId = typeof metadata.sessionId === 'string' ? metadata.sessionId : null;
	const points = Array.isArray(data.trackPoints) ? (data.trackPoints as StoredTrackPoint[]) : [];

	if (!sessionId || points.length === 0) return false;

	const sportType = typeof data.sportType === 'string' ? data.sportType : undefined;
	const name = `${describeWorkoutSportType(sportType ?? '')} — ${new Intl.DateTimeFormat('nb-NO', {
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	}).format(eventRow.timestamp)}`;

	const gpx = buildGpx(points, { name, sportType });
	const result = await pushSession({
		userId,
		appId,
		sessionId,
		gpx,
		sportType,
		name,
		sensorEventId: eventRow.id
	});
	return result.pushed;
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	if (!(await getConnection(userId))) {
		return json({ error: 'Strava ikke tilkoblet' }, { status: 409 });
	}

	const body = await request.json().catch(() => ({}));
	const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : null;
	const appId = typeof body?.app === 'string' ? body.app : 'ekko';

	if (sessionId) {
		const eventRow = await db.query.sensorEvents.findFirst({
			where: and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'workout'),
				sql`${sensorEvents.metadata}->>'sessionId' = ${sessionId}`
			)
		});
		if (!eventRow) {
			return json({ error: 'Fant ingen lagret økt for sessionId' }, { status: 404 });
		}
		const pushed = await syncEvent(userId, appId, eventRow);
		if (!pushed) {
			return json({ error: 'Økten mangler GPS-data eller er allerede synket' }, { status: 409 });
		}
		return json({ queued: true }, { status: 202 });
	}

	// Backfill: siste N workout-økter (pushSession dedup-er allerede-synkede).
	const recent = await db.query.sensorEvents.findMany({
		where: and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'workout')),
		orderBy: [desc(sensorEvents.timestamp)],
		limit: BACKFILL_LIMIT
	});

	let count = 0;
	for (const eventRow of recent) {
		if (await syncEvent(userId, appId, eventRow)) count += 1;
	}

	return json({ queued: true, count }, { status: 202 });
};
