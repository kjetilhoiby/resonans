import { error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { liveSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { liveSessionOgPng } from '$lib/server/live-og-cache';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const session = await db.query.liveSessions.findFirst({
		where: eq(liveSessions.token, params.token)
	});
	if (!session) throw error(404);

	const png = await liveSessionOgPng(session.id, {
		routeCoordinates: session.routeCoordinates as [number, number][] | null,
		lastLat: session.lastLat,
		lastLon: session.lastLon,
		destLat: session.destLat,
		destLon: session.destLon,
		endedReason: session.endedReason,
		endedAt: session.endedAt
	});

	return new Response(png as BodyInit, {
		headers: {
			'Content-Type': 'image/png',
			'Cache-Control': 'public, max-age=30, s-maxage=30'
		}
	});
};
