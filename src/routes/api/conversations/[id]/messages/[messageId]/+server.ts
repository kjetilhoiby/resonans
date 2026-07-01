import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { messages, conversations } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

async function verifyConversationOwner(conversationId: string, userId: string) {
	const [conv] = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
	return conv ?? null;
}

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const body = await request.json();
	const { starred, content } = body as { starred?: boolean; content?: string };

	const updates: { starred?: boolean; content?: string } = {};
	if (typeof starred === 'boolean') updates.starred = starred;
	if (content !== undefined) {
		if (typeof content !== 'string') {
			return json({ error: 'content must be a string' }, { status: 400 });
		}
		updates.content = content;
	}

	if (Object.keys(updates).length === 0) {
		return json({ error: 'No valid fields to update' }, { status: 400 });
	}

	// Verify message belongs to a conversation owned by this user
	if (!(await verifyConversationOwner(params.id, locals.userId))) {
		return json({ error: 'Conversation not found' }, { status: 404 });
	}

	const [updated] = await db
		.update(messages)
		.set(updates)
		.where(and(eq(messages.id, params.messageId), eq(messages.conversationId, params.id)))
		.returning({ id: messages.id, starred: messages.starred, content: messages.content });

	if (!updated) {
		return json({ error: 'Message not found' }, { status: 404 });
	}

	return json(updated);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!(await verifyConversationOwner(params.id, locals.userId))) {
		return json({ error: 'Conversation not found' }, { status: 404 });
	}

	const [deleted] = await db
		.delete(messages)
		.where(and(eq(messages.id, params.messageId), eq(messages.conversationId, params.id)))
		.returning({ id: messages.id });

	if (!deleted) {
		return json({ error: 'Message not found' }, { status: 404 });
	}

	return new Response(null, { status: 204 });
};
