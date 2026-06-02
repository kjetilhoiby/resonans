import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import { liveSessions, users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import {
	getOrCreateTripPositionShareToken,
	ShareTokensStorageNotReadyError
} from '$lib/server/share-tokens';
import type { PageServerLoad } from './$types';

/**
 * Eldre /live/<session-token>-lenker (delt før vi gikk over til den generiske
 * share-token-infrastrukturen) redirectes til /share/<share-token>. Vi minter
 * et tripPosition-token on-the-fly hvis sesjonen ikke har ett ennå, slik at
 * gamle lenker i naturen fortsatt virker — nå med utløp/revoke/tilgangslogg.
 *
 * Faller tilbake til den innebygde /live-visningen hvis share-lagringen ikke
 * er klar (f.eks. share_tokens-tabellen mangler).
 */
export const load: PageServerLoad = async ({ params }) => {
	const session = await db.query.liveSessions.findFirst({
		where: eq(liveSessions.token, params.token)
	});

	if (!session) throw error(404, 'Denne lenken finnes ikke.');

	let shareToken: string | null = null;
	try {
		const share = await getOrCreateTripPositionShareToken(session.userId, session.id);
		shareToken = share.token;
	} catch (err) {
		if (!(err instanceof ShareTokensStorageNotReadyError)) throw err;
		// Fortsett til fallback-render under.
	}

	if (shareToken) {
		throw redirect(307, `/share/${shareToken}`);
	}

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
