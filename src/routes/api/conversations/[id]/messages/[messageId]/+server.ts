import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { messages, conversations } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const body = await request.json();
	const { starred } = body as { starred?: boolean };

	if (typeof starred !== 'boolean') {
		return json({ error: 'starred must be a boolean' }, { status: 400 });
	}

	// Verify message belongs to a conversation owned by this user
	const [conv] = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(and(eq(conversations.id, params.id), eq(conversations.userId, locals.userId)));

	if (!conv) {
		return json({ error: 'Conversation not found' }, { status: 404 });
	}

	const [updated] = await db
		.update(messages)
		.set({ starred })
		.where(and(eq(messages.id, params.messageId), eq(messages.conversationId, params.id)))
		.returning({ id: messages.id, starred: messages.starred });

	if (!updated) {
		return json({ error: 'Message not found' }, { status: 404 });
	}

	return json(updated);
};
