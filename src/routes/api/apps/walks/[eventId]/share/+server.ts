import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getOrCreateWalkPlaybackShareToken, buildShareUrl } from '$lib/server/share-tokens';
import type { RequestHandler } from './$types';

/**
 * Lag (eller gjenbruk) en delelenke til 3D-avspillingen av en gåtur. `eventId`
 * er workout-eventet turen ble lastet opp som (fra /api/apps/upload-svaret).
 * `url` eies av Resonans og brukes UENDRET av Ekko. Speiler /api/story/share.
 */
export const POST: RequestHandler = async ({ locals, params, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const walk = await db.query.sensorEvents.findFirst({
		where: and(
			eq(sensorEvents.id, params.eventId),
			eq(sensorEvents.userId, userId),
			eq(sensorEvents.dataType, 'workout')
		),
		columns: { id: true }
	});
	if (!walk) throw error(404, 'Fant ikke turen');

	const token = await getOrCreateWalkPlaybackShareToken(userId, walk.id);
	return json({ token: token.token, url: buildShareUrl(url.origin, token.token) });
};
