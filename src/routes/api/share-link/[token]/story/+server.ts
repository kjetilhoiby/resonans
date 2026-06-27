import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { storySessions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { resolveShareToken, recordShareAccess } from '$lib/server/share-tokens';
import { projectStoryBoard, toStorySessionState } from '$lib/server/assistant/story-logic';
import type { RequestHandler } from './$types';

/**
 * Offentlig (token-basert) poll-endepunkt for den delte fortellerskjermen — baksetets nettbrett
 * henter live fortellings-tilstand her. Krever et gyldig storySession-share-token. Den fulle
 * teksten (`story`) holdes skjult til ended === true (se projectStoryBoard). Samme offentlige
 * /api/share-link-mønster som /quiz og /position.
 */
export const GET: RequestHandler = async ({ params }) => {
	const share = await resolveShareToken(params.token);
	if (!share || share.resourceType !== 'storySession') {
		return json({ error: 'not_found' }, { status: 404 });
	}

	const session = await db.query.storySessions.findFirst({
		where: and(eq(storySessions.id, share.resourceId), eq(storySessions.userId, share.ownerUserId))
	});
	if (!session) {
		return json({ error: 'not_found' }, { status: 404 });
	}

	await recordShareAccess(share.tokenId);
	return json(projectStoryBoard(toStorySessionState(session)));
};
