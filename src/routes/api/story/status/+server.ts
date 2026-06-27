import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { storySessions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { resolveRequestUserId } from '$lib/server/request-user';
import { projectStoryBoard, toStorySessionState } from '$lib/server/assistant/story-logic';
import type { RequestHandler } from './$types';

/**
 * Live fortellings-tilstand for innlogget bruker — fortellerskjermen poller dette. Ingen aktiv
 * fortelling ⇒ { active: false }. Den fulle teksten (`story`) holdes skjult til ended === true
 * (se projectStoryBoard), så en delt skjerm i baksetet ikke røper slutten. Speiler /api/quiz/status.
 */
export const GET: RequestHandler = async (event) => {
	const userId = await resolveRequestUserId(event);
	const rows = await db
		.select()
		.from(storySessions)
		.where(and(eq(storySessions.userId, userId), eq(storySessions.active, true)))
		.limit(1);
	if (!rows[0]) return json({ active: false });
	return json(projectStoryBoard(toStorySessionState(rows[0])));
};
