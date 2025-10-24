import { db } from '$lib/db';
import { conversations, messages } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { DEFAULT_USER_ID } from '$lib/server/users';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// Finn den nyeste samtalen for brukeren
	const conversation = await db.query.conversations.findFirst({
		where: eq(conversations.userId, DEFAULT_USER_ID),
		orderBy: [desc(conversations.updatedAt)]
	});

	if (!conversation) {
		return {
			messages: []
		};
	}

	// Hent meldinger fra samtalen
	const conversationMessages = await db.query.messages.findMany({
		where: eq(messages.conversationId, conversation.id),
		orderBy: (messages, { asc }) => [asc(messages.createdAt)]
	});

	return {
		messages: conversationMessages.map(msg => ({
			id: msg.id,
			role: msg.role as 'user' | 'assistant' | 'system',
			content: msg.content,
			timestamp: msg.createdAt.toISOString()
		}))
	};
};
