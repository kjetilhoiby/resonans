import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { liveSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { resolveShareToken } from '$lib/server/share-tokens';
import type { RequestHandler } from './$types';

/**
 * Poll-endepunkt for delt live posisjon. tripPosition-token peker på en
 * live_sessions-rad (push-matet av appen via /api/apps/live-session).
 * Returnerer samme form som /api/live/[token] slik at delings-visningen og
 * /live-siden kan dele logikk.
 */
export const GET: RequestHandler = async ({ params }) => {
	const share = await resolveShareToken(params.token);
	if (!share || share.resourceType !== 'tripPosition') {
		return json({ error: 'not_found' }, { status: 404 });
	}

	const session = await db.query.liveSessions.findFirst({
		where: eq(liveSessions.id, share.resourceId)
	});
	if (!session || session.userId !== share.ownerUserId) {
		return json({ error: 'not_found' }, { status: 404 });
	}

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
