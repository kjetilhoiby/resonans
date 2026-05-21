import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { liveSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const session = await db.query.liveSessions.findFirst({
		where: eq(liveSessions.token, params.token)
	});

	if (!session) return json({ error: 'not_found' }, { status: 404 });

	return json({
		lastLat: session.lastLat,
		lastLon: session.lastLon,
		lastSpeedMps: session.lastSpeedMps,
		etaSeconds: session.etaSeconds,
		distanceRemainingM: session.distanceRemainingM,
		progressFraction: session.progressFraction,
		lastPingAt: session.lastPingAt?.toISOString() ?? null,
		endedAt: session.endedAt?.toISOString() ?? null,
		endedReason: session.endedReason
	});
};
