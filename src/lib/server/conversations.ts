import { db, pgClient } from '$lib/db';
import { conversations, messages, themes, books } from '$lib/db/schema';
import { eq, desc, and, asc, sql, inArray, isNull } from 'drizzle-orm';
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

export async function createConversation(userId: string) {
	await ensureConversationThemeIdColumn();
	const result = await db.insert(conversations).values({ userId, title: 'Ny samtale' }).returning();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (result as any[])[0];
}

export async function getOrCreateConversation(userId: string) {
	await ensureConversationThemeIdColumn();

	// Finn den nyeste aktive samtalen for brukeren — ekskluder boksamtaler
	// (boksamtaler er linked fra books.conversation_id og skal aldri brukes som fallback-samtale)
	const rows = await db
		.select({ conversation: conversations })
		.from(conversations)
		.leftJoin(books, eq(books.conversationId, conversations.id))
		.where(and(eq(conversations.userId, userId), isNull(books.id)))
		.orderBy(desc(conversations.updatedAt))
		.limit(1);

	const existingConversation = rows[0]?.conversation ?? null;

	if (existingConversation) {
		return existingConversation;
	}

	// Opprett ny samtale hvis ingen finnes
	const result = await db.insert(conversations).values({
		userId,
		title: 'Ny samtale'
	}).returning();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const newConversation = (result as any[])[0];

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

export async function getUserConversationList(userId: string, options?: { limit?: number }) {
	await ensureConversationThemeIdColumn();

	const requestedLimit = options?.limit;
	const normalizedLimit =
		typeof requestedLimit === 'number' && Number.isFinite(requestedLimit) && requestedLimit > 0
			? Math.floor(requestedLimit)
			: undefined;

	const userConversations = await db.query.conversations.findMany({
		where: eq(conversations.userId, userId),
		orderBy: [desc(conversations.updatedAt)],
		...(normalizedLimit ? { limit: normalizedLimit } : {})
	});

	if (userConversations.length === 0) return [];

	const conversationIds = userConversations.map((c) => c.id);

	// Batch: hent første brukermelding per samtale og linked themes i parallell
	const [firstUserMessages, linkedThemes] = await Promise.all([
		db
			.selectDistinctOn([messages.conversationId], {
				conversationId: messages.conversationId,
				content: messages.content
			})
			.from(messages)
			.where(and(inArray(messages.conversationId, conversationIds), eq(messages.role, 'user')))
			.orderBy(messages.conversationId, asc(messages.createdAt)),
		db.query.themes.findMany({
			where: inArray(themes.conversationId, conversationIds),
			columns: { id: true, name: true, emoji: true, conversationId: true }
		})
	]);

	const previewMap = new Map(firstUserMessages.map((m) => [m.conversationId, m.content]));
	const themeMap = new Map(linkedThemes.map((t) => [t.conversationId, t]));

	return userConversations.map((conversation) => {
		const raw = previewMap.get(conversation.id) || '';
		const firstSentence = raw.split(/[.!?]\s/)[0].replace(/\*\*/g, '').trim();
		const preview = firstSentence.length > 120 ? firstSentence.slice(0, 117) + '…' : firstSentence;
		const linkedTheme = themeMap.get(conversation.id) ?? null;

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
	});
}
