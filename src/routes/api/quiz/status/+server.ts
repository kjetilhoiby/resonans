import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { quizSessions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { resolveRequestUserId } from '$lib/server/request-user';
import { projectQuizBoard, toQuizSessionState } from '$lib/server/assistant/quiz-logic';
import type { RequestHandler } from './$types';

/**
 * Live quiz-tilstand for innlogget bruker — spillskjermen (/spill) poller dette.
 * Fasiten holdes skjult til spørsmålet er besvart (se projectQuizBoard).
 */
export const GET: RequestHandler = async (event) => {
	const userId = await resolveRequestUserId(event);
	const rows = await db
		.select()
		.from(quizSessions)
		.where(and(eq(quizSessions.userId, userId), eq(quizSessions.active, true)))
		.limit(1);
	if (!rows[0]) return json({ active: false });
	return json(projectQuizBoard(toQuizSessionState(rows[0])));
};
