import { db } from '$lib/db';
import { quizSessions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { resolveRequestUserId } from '$lib/server/request-user';
import { projectQuizBoard, toQuizSessionState } from '$lib/server/assistant/quiz-logic';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const userId = await resolveRequestUserId(event);
	const rows = await db
		.select()
		.from(quizSessions)
		.where(and(eq(quizSessions.userId, userId), eq(quizSessions.active, true)))
		.limit(1);
	const board = rows[0] ? projectQuizBoard(toQuizSessionState(rows[0])) : { active: false as const };
	return { board };
};
