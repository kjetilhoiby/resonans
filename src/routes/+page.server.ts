import { db } from '$lib/db';
import { conversations, messages } from '$lib/db/schema';
import { eq, desc, lt } from 'drizzle-orm';
import { DEFAULT_USER_ID } from '$lib/server/users';
import type { PageServerLoad } from './$types';

const MESSAGES_PER_PAGE = 30;

export const load: PageServerLoad = async () => {
	// Finn den nyeste samtalen for brukeren
	const conversation = await db.query.conversations.findFirst({
		where: eq(conversations.userId, DEFAULT_USER_ID),
		orderBy: [desc(conversations.updatedAt)]
	});

	if (!conversation) {
		return {
			messages: [],
			conversationId: null,
			hasMore: false
		};
	}

	// Hent de siste N meldingene (nyeste først, så reverserer vi)
	const conversationMessages = await db.query.messages.findMany({
		where: eq(messages.conversationId, conversation.id),
		orderBy: [desc(messages.createdAt)],
		limit: MESSAGES_PER_PAGE
	});

	// Reverser så de eldste er først (for riktig rekkefølge i UI)
	const sortedMessages = conversationMessages.reverse();

	return {
		messages: sortedMessages.map(msg => ({
			id: msg.id,
			role: msg.role as 'user' | 'assistant' | 'system',
			content: msg.content,
			timestamp: msg.createdAt.toISOString(),
			imageUrl: msg.imageUrl
		})),
		conversationId: conversation.id,
		hasMore: conversationMessages.length === MESSAGES_PER_PAGE
	};
};
