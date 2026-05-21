import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { themes, sensorEvents } from '$lib/db/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { resolveShareToken } from '$lib/server/share-tokens';
import type { RequestHandler } from './$types';

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const R = 6371;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLng = toRad(lng2 - lng1);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

const STALE_MINUTES = 2;

export const GET: RequestHandler = async ({ params }) => {
	const share = await resolveShareToken(params.token);
	if (!share || share.resourceType !== 'tripPosition') {
		return json({ error: 'not_found' }, { status: 404 });
	}

	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, share.resourceId), eq(themes.userId, share.ownerUserId))
	});
	if (!theme) return json({ error: 'not_found' }, { status: 404 });

	const latest = await db.query.sensorEvents.findFirst({
		where: and(
			eq(sensorEvents.userId, share.ownerUserId),
			inArray(sensorEvents.dataType, ['gps', 'location'])
		),
		orderBy: [desc(sensorEvents.timestamp)]
	});

	const destLat = theme.tripProfile?.lat ?? null;
	const destLng = theme.tripProfile?.lng ?? null;
	const destination = theme.tripProfile?.destination ?? null;
	const currentLat = (latest?.data?.lat as number | undefined) ?? null;
	const currentLng = (latest?.data?.lng as number | undefined) ?? null;
	const speedKmh = (latest?.data?.speedKmh as number | undefined) ?? null;
	const sportType = (latest?.data?.sportType as string | undefined) ?? null;
	const ended = (latest?.data?.ended as boolean | undefined) ?? false;
	const timestamp = latest?.timestamp ?? null;

	let distanceKm: number | null = null;
	let etaMinutes: number | null = null;
	if (currentLat !== null && currentLng !== null && destLat !== null && destLng !== null) {
		distanceKm = haversineKm(currentLat, currentLng, destLat, destLng);
		const speed = Math.max(speedKmh ?? 0, 5);
		etaMinutes = Math.round((distanceKm / speed) * 60);
	}

	const isStale =
		!timestamp || Date.now() - timestamp.getTime() > STALE_MINUTES * 60 * 1000;

	return json({
		currentLat,
		currentLng,
		destLat,
		destLng,
		destination,
		speedKmh,
		sportType,
		distanceKm,
		etaMinutes,
		ended,
		isStale,
		timestamp
	});
};
