import { db } from '$lib/db';
import { conversations, messages } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';

export interface CreateConversationParams {
	userId: string;
	title?: string;
}

export interface AddMessageParams {
	conversationId: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	metadata?: any;
	imageUrl?: string;
}

export async function getOrCreateConversation(userId: string) {
	// Finn den nyeste aktive samtalen for brukeren
	const existingConversation = await db.query.conversations.findFirst({
		where: eq(conversations.userId, userId),
		orderBy: [desc(conversations.updatedAt)]
	});

	if (existingConversation) {
		return existingConversation;
	}

	// Opprett ny samtale hvis ingen finnes
	const [newConversation] = await db.insert(conversations).values({
		userId,
		title: 'Ny samtale'
	}).returning();

	return newConversation;
}

export async function addMessage(params: AddMessageParams) {
	const [message] = await db.insert(messages).values({
		conversationId: params.conversationId,
		role: params.role,
		content: params.content,
		imageUrl: params.imageUrl,
		metadata: params.metadata
	}).returning();

	// Oppdater conversation timestamp
	await db.update(conversations)
		.set({ updatedAt: new Date() })
		.where(eq(conversations.id, params.conversationId));

	return message;
}

export async function getConversationMessages(conversationId: string) {
	return await db.query.messages.findMany({
		where: eq(messages.conversationId, conversationId),
		orderBy: (messages, { asc }) => [asc(messages.createdAt)]
	});
}

export async function getConversationHistory(conversationId: string, limit: number = 20) {
	const msgs = await db.query.messages.findMany({
		where: eq(messages.conversationId, conversationId),
		orderBy: (messages, { desc }) => [desc(messages.createdAt)],
		limit
	});

	// Returner i kronologisk rekkefølge (eldst først)
	return msgs.reverse();
}
