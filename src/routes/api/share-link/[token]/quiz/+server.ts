import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { quizSessions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { resolveShareToken, recordShareAccess } from '$lib/server/share-tokens';
import { projectQuizBoard, toQuizSessionState } from '$lib/server/assistant/quiz-logic';
import type { RequestHandler } from './$types';

/**
 * Offentlig (token-basert) poll-endepunkt for den delte spillskjermen — barnas nettbrett i
 * baksetet henter live quiz-tilstand her. Krever et gyldig quizSession-share-token. Fasiten
 * holdes skjult til spørsmålet er besvart (se projectQuizBoard). Ligger under den offentlige
 * /api/share-link-prefiksen, på linje med /position for delt reise.
 */
export const GET: RequestHandler = async ({ params }) => {
	const share = await resolveShareToken(params.token);
	if (!share || share.resourceType !== 'quizSession') {
		return json({ error: 'not_found' }, { status: 404 });
	}

	const session = await db.query.quizSessions.findFirst({
		where: and(eq(quizSessions.id, share.resourceId), eq(quizSessions.userId, share.ownerUserId))
	});
	if (!session) {
		return json({ error: 'not_found' }, { status: 404 });
	}

	await recordShareAccess(share.tokenId);
	return json(projectQuizBoard(toQuizSessionState(session)));
};
