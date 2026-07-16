import { json } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { messages } from '$lib/db/schema';
import { getConversationByIdForUser } from '$lib/server/conversations';
import { segmentConversationBySteps, type ConversationMsg } from '$lib/flows/livsintervju';
import type { RequestHandler } from './$types';

/**
 * Rekonstruer livsintervjuets steg-tråder fra den varige DB-samtalen.
 * «Samtalen er data»: databasen er fasit — localStorage-utkastet bare en kopi.
 * autoSend-promptene ligger som brukermeldinger i samtalen og brukes som
 * steg-grenser; ved historiske omstarts-duplikater vinner lengste segment.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	const body = await request.json();

	const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : '';
	if (!conversationId) {
		return json({ error: 'Mangler conversationId' }, { status: 400 });
	}
	const conversation = await getConversationByIdForUser(conversationId, userId);
	if (!conversation) {
		return json({ error: 'Ukjent samtale' }, { status: 404 });
	}

	const rows = await db.query.messages.findMany({
		where: and(eq(messages.conversationId, conversationId)),
		orderBy: [asc(messages.createdAt)],
		columns: { role: true, content: true }
	});

	const conversationMsgs: ConversationMsg[] = rows
		.filter((r): r is { role: 'user' | 'assistant'; content: string } =>
			(r.role === 'user' || r.role === 'assistant') && typeof r.content === 'string'
		)
		.map((r) => ({ role: r.role, content: r.content }));

	return json({ threads: segmentConversationBySteps(conversationMsgs) });
};
