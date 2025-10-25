import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { messages } from '$lib/db/schema';
import { eq, and, lt, desc } from 'drizzle-orm';
import type { RequestHandler } from './$types';

const MESSAGES_PER_PAGE = 30;

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { conversationId, beforeTimestamp } = await request.json();

		if (!conversationId || !beforeTimestamp) {
			return json({ error: 'Missing required parameters' }, { status: 400 });
		}

		// Hent eldre meldinger (før den gitte tidsstempelet)
		const olderMessages = await db.query.messages.findMany({
			where: and(
				eq(messages.conversationId, conversationId),
				lt(messages.createdAt, new Date(beforeTimestamp))
			),
			orderBy: [desc(messages.createdAt)],
			limit: MESSAGES_PER_PAGE
		});

		// Reverser så de eldste er først
		const sortedMessages = olderMessages.reverse();

		return json({
			messages: sortedMessages.map(msg => ({
				id: msg.id,
				role: msg.role,
				content: msg.content,
				timestamp: msg.createdAt.toISOString(),
				imageUrl: msg.imageUrl
			})),
			hasMore: olderMessages.length === MESSAGES_PER_PAGE
		});
	} catch (error) {
		console.error('Error loading more messages:', error);
		return json({ error: 'Failed to load messages' }, { status: 500 });
	}
};
