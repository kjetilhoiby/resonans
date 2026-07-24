import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes, sensorEvents } from '$lib/db/schema';
import { and, eq, gte, lte, desc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { buildDriveRoutes, type DriveRoutes, type DrivePoint } from '$lib/server/tesla-routes';
import { fetchWalkData } from '$lib/server/walk-playback';
import { placeImagesOnTrack } from '$lib/components/domain/walk-playback';
import { describeWorkoutSportType } from '$lib/server/workout-taxonomy';

// Importerer en gåtur (opplastet workout-event) inn i kartfortellingen: sporet
// foldes inn i tripProfile.driveRoutes (per Oslo-dag, samme form som Tesla-
// importen), og vedlagte bilder plasseres langs sporet og legges som imagePins.
// Frosset i profilen slik at kartet overlever at sensor_events tynnes ut.

function osloDay(d: Date): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/Oslo',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(d);
}

async function loadTheme(id: string, userId: string) {
	return db.query.themes.findFirst({
		where: and(eq(themes.id, id), eq(themes.userId, userId)),
		columns: { id: true, tripProfile: true, ferieProfile: true }
	});
}

/** Kandidat-turer å importere: opplastede workout-økter med spor i turvinduet. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const theme = await loadTheme(params.id, locals.userId);
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const trip = (theme.tripProfile ?? {}) as { startDate?: string; endDate?: string };
	const ferie = (theme.ferieProfile ?? {}) as { startDate?: string; endDate?: string };
	const startDate = trip.startDate ?? ferie.startDate;
	const endDate = trip.endDate ?? ferie.endDate;

	// Rause UTC-grenser (±1 døgn) rundt turvinduet; uten vindu: siste 90 dager.
	const now = Date.now();
	const from = startDate ? new Date(Date.parse(`${startDate}T00:00:00Z`) - 86_400_000) : new Date(now - 90 * 86_400_000);
	const to = endDate ? new Date(Date.parse(`${endDate}T23:59:59Z`) + 86_400_000) : new Date(now);

	const rows = await db.query.sensorEvents.findMany({
		where: and(
			eq(sensorEvents.userId, locals.userId),
			eq(sensorEvents.dataType, 'workout'),
			gte(sensorEvents.timestamp, from),
			lte(sensorEvents.timestamp, to)
		),
		columns: { id: true, data: true, timestamp: true },
		orderBy: [desc(sensorEvents.timestamp)],
		limit: 60
	});

	const walks = rows
		.map((r) => {
			const d = (r.data ?? {}) as Record<string, unknown>;
			const track = Array.isArray(d.trackPoints) ? d.trackPoints : [];
			if (track.length < 2) return null;
			const sportType = typeof d.sportType === 'string' ? d.sportType : null;
			return {
				eventId: r.id,
				sportType,
				title: sportType ? describeWorkoutSportType(sportType) : 'Tur',
				startedAt: r.timestamp.toISOString(),
				distanceMeters: typeof d.distance === 'number' ? Math.round(d.distance) : null
			};
		})
		.filter((w): w is NonNullable<typeof w> => w !== null);

	return json({ walks });
};

/** Importer én valgt gåtur inn i kartfortellingen. */
export const POST: RequestHandler = async ({ params, locals, request }) => {
	const theme = await loadTheme(params.id, locals.userId);
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const body = (await request.json().catch(() => ({}))) as { eventId?: string };
	const eventId = typeof body.eventId === 'string' ? body.eventId : null;
	if (!eventId) return json({ error: 'Mangler eventId' }, { status: 400 });

	const walk = await fetchWalkData(locals.userId, eventId);
	if (!walk) return json({ error: 'Fant ikke turen' }, { status: 404 });

	// Spor → kjørespor-form (per Oslo-dag). Punkter uten tid får turens starttid.
	const points: DrivePoint[] = walk.track.map((p) => ({
		lat: p.lat,
		lon: p.lon,
		timestamp: p.time ? new Date(p.time) : walk.startedAt
	}));
	const built = buildDriveRoutes(points);
	const primaryDay = Object.keys(built).sort()[0] ?? osloDay(walk.startedAt);

	// Bilder plasseres langs sporet (tid → geo → jevn fordeling) og blir imagePins.
	const placed = placeImagesOnTrack(walk.track, walk.images);
	const newPins = placed.map((p) => ({
		id: randomUUID(),
		url: p.url,
		lat: p.lat,
		lon: p.lon,
		caption: p.caption,
		date: primaryDay
	}));

	// RMW-merge: hent fersk profil, fold sporet inn per dag (overskriver samme dag,
	// som Tesla-importen → idempotent re-import), og legg til bilder dedup-et på url.
	const fresh = await loadTheme(params.id, locals.userId);
	const profile = { ...((fresh?.tripProfile ?? {}) as Record<string, unknown>) };
	profile.driveRoutes = { ...((profile.driveRoutes ?? {}) as DriveRoutes), ...built };

	const newUrls = new Set(newPins.map((p) => p.url));
	const existingPins = Array.isArray(profile.imagePins) ? (profile.imagePins as Array<{ url?: string }>) : [];
	profile.imagePins = [...existingPins.filter((p) => !p.url || !newUrls.has(p.url)), ...newPins];

	await db
		.update(themes)
		.set({ tripProfile: profile, updatedAt: new Date() })
		.where(and(eq(themes.id, params.id), eq(themes.userId, locals.userId)));

	return json({
		days: Object.keys(built).length,
		points: Object.values(built).reduce((sum, c) => sum + c.length, 0),
		images: newPins.length
	});
};
