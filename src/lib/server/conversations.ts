import { db } from '$lib/db';
import { conversations, messages, themes } from '$lib/db/schema';
import { eq, desc, and, asc, sql } from 'drizzle-orm';
import { ensureConversationThemeIdColumn } from '$lib/server/conversation-schema';

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

function isGenericConversationTitle(title: string | null | undefined) {
	if (!title) return true;
	return title === 'Ny samtale' || title.startsWith('Ny samtale -');
}

function generateConversationTitle(content: string) {
	const cleaned = content
		.replace(/[#*_`>~\-]+/g, ' ')
		.replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/https?:\/\/\S+/g, ' ')
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.toLowerCase()
		.trim();

	const stopwords = new Set([
		'jeg', 'du', 'vi', 'det', 'den', 'de', 'en', 'et', 'ei', 'og', 'å', 'av', 'på', 'i', 'til',
		'for', 'med', 'om', 'at', 'er', 'har', 'skal', 'vil', 'kan', 'som', 'meg', 'min', 'mitt',
		'mine', 'din', 'ditt', 'dine', 'vår', 'vårt', 'våre', 'hjelp', 'trenger', 'ønsker', 'lurer'
	]);

	const parts = cleaned
		.split(/\s+/)
		.filter((word) => word.length > 1 && !stopwords.has(word))
		.slice(0, 3);

	if (parts.length === 0) return 'Ny samtale';

	return parts
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

export async function getOrCreateConversation(userId: string) {
	await ensureConversationThemeIdColumn();

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
	await ensureConversationThemeIdColumn();

	const [message] = await db.insert(messages).values({
		conversationId: params.conversationId,
		role: params.role,
		content: params.content,
		imageUrl: params.imageUrl,
		metadata: params.metadata
	}).returning();

	const conversation = await db.query.conversations.findFirst({
		where: eq(conversations.id, params.conversationId)
	});

	const updates: { updatedAt: Date; title?: string } = {
		updatedAt: new Date()
	};

	if (params.role === 'user' && conversation && isGenericConversationTitle(conversation.title)) {
		const themedConversation = await db.query.themes.findFirst({
			where: eq(themes.conversationId, params.conversationId)
		});

		if (!themedConversation) {
			const userMessageCount = await db
				.select({ count: sql<number>`count(*)::int` })
				.from(messages)
				.where(and(eq(messages.conversationId, params.conversationId), eq(messages.role, 'user')));

			if ((userMessageCount[0]?.count ?? 0) <= 1) {
				updates.title = generateConversationTitle(params.content);
			}
		}
	}

	await db.update(conversations)
		.set(updates)
		.where(eq(conversations.id, params.conversationId));

	return message;
}

export async function getConversationMessages(conversationId: string) {
	return await db.query.messages.findMany({
		where: eq(messages.conversationId, conversationId),
		orderBy: (messages, { asc }) => [asc(messages.createdAt)]
	});
}

/**
 * Henter en spesifikk samtale og verifiserer at den tilhører brukeren.
 * Returnerer null om ikke funnet eller feil bruker.
 */
export async function getConversationByIdForUser(conversationId: string, userId: string) {
	await ensureConversationThemeIdColumn();

	return await db.query.conversations.findFirst({
		where: and(eq(conversations.id, conversationId), eq(conversations.userId, userId))
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

export async function getConversationsByTheme(userId: string, themeId: string) {
	await ensureConversationThemeIdColumn();

	const themeConversations = await db.query.conversations.findMany({
		where: and(
			eq(conversations.userId, userId),
			eq(conversations.themeId, themeId)
		),
		orderBy: [desc(conversations.updatedAt)]
	});

	return await Promise.all(
		themeConversations.map(async (conversation) => {
			const [firstUserMessage] = await db.query.messages.findMany({
				where: and(
					eq(messages.conversationId, conversation.id),
					eq(messages.role, 'user')
				),
				orderBy: [asc(messages.createdAt)],
				limit: 1
			});

			const raw = firstUserMessage?.content || '';
			const firstSentence = raw.split(/[.!?]\s/)[0].replace(/\*\*/g, '').trim();
			const preview = firstSentence.length > 120
				? firstSentence.slice(0, 117) + '…'
				: firstSentence;

			return {
				id: conversation.id,
				title: conversation.title || 'Ny samtale',
				updatedAt: conversation.updatedAt,
				createdAt: conversation.createdAt,
				preview
			};
		})
	);
}

export async function getUserConversationList(userId: string) {
	await ensureConversationThemeIdColumn();

	const userConversations = await db.query.conversations.findMany({
		where: eq(conversations.userId, userId),
		orderBy: [desc(conversations.updatedAt)]
	});

	return await Promise.all(
		userConversations.map(async (conversation) => {
			// Hent første brukermelding for preview
			const [firstUserMessage] = await db.query.messages.findMany({
				where: and(
					eq(messages.conversationId, conversation.id),
					eq(messages.role, 'user')
				),
				orderBy: [asc(messages.createdAt)],
				limit: 1
			});

			const linkedTheme = await db.query.themes.findFirst({
				where: eq(themes.conversationId, conversation.id)
			});

			// Første setning, maks 120 tegn
			const raw = firstUserMessage?.content || '';
			const firstSentence = raw.split(/[.!?]\s/)[0].replace(/\*\*/g, '').trim();
			const preview = firstSentence.length > 120
				? firstSentence.slice(0, 117) + '…'
				: firstSentence;

			return {
				id: conversation.id,
				title: conversation.title || 'Ny samtale',
				updatedAt: conversation.updatedAt,
				createdAt: conversation.createdAt,
				preview,
				linkedTheme: linkedTheme
					? { id: linkedTheme.id, name: linkedTheme.name, emoji: linkedTheme.emoji }
					: null
			};
		})
	);
}
