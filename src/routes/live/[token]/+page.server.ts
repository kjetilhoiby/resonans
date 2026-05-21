import { error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { liveSessions, users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const session = await db.query.liveSessions.findFirst({
		where: eq(liveSessions.token, params.token)
	});

	if (!session) throw error(404, 'Denne lenken finnes ikke.');

	const owner = await db.query.users.findFirst({
		where: eq(users.id, session.userId),
		columns: { name: true }
	});

	return {
		token: params.token,
		ownerName: owner?.name ?? null,
		sportType: session.sportType,
		routeLabel: session.routeLabel,
		routeCoordinates: session.routeCoordinates as [number, number][] | null,
		destLat: session.destLat,
		destLon: session.destLon,
		destLabel: session.destLabel,
		routeDistanceM: session.routeDistanceM,
		lastLat: session.lastLat,
		lastLon: session.lastLon,
		lastSpeedMps: session.lastSpeedMps,
		etaSeconds: session.etaSeconds,
		distanceRemainingM: session.distanceRemainingM,
		progressFraction: session.progressFraction,
		startedAt: session.startedAt.toISOString(),
		lastPingAt: session.lastPingAt?.toISOString() ?? null,
		endedAt: session.endedAt?.toISOString() ?? null,
		endedReason: session.endedReason
	};
};
