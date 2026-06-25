import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { quizSessions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { resolveShareToken, recordShareAccess } from '$lib/server/share-tokens';
import { projectQuizBoard, toQuizSessionState } from '$lib/server/assistant/quiz-logic';
import type { RequestHandler } from './$types';

/**
 * Offentlig (token-basert) live quiz-tilstand — den delte spillskjermen for barna i baksetet
 * poller dette. Krever et gyldig quizSession-share-token. Fasiten holdes skjult til besvart.
 */
export const GET: RequestHandler = async ({ params }) => {
	const share = await resolveShareToken(params.token);
	if (!share || share.resourceType !== 'quizSession') {
		throw error(404, 'Lenken finnes ikke lenger eller er utløpt.');
	}

	const rows = await db
		.select()
		.from(quizSessions)
		.where(and(eq(quizSessions.id, share.resourceId), eq(quizSessions.userId, share.ownerUserId)))
		.limit(1);
	if (!rows[0]) throw error(404, 'Quizen finnes ikke lenger.');

	await recordShareAccess(share.tokenId);
	return json(projectQuizBoard(toQuizSessionState(rows[0])));
};
