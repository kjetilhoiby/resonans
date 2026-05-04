import { redirect } from '@sveltejs/kit';
import { getConversationByIdForUser, getConversationMessages, getUserConversationList } from '$lib/server/conversations';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const conversationId = url.searchParams.get('conversation');
	const [conversationList, userThemes] = await Promise.all([
		getUserConversationList(locals.userId),
		db.query.themes.findMany({
			where: eq(themes.userId, locals.userId),
			columns: { id: true, name: true, emoji: true }
		})
	]);

	const conversations = conversationList.map((c) => ({
		...c,
		updatedAt: c.updatedAt.toISOString(),
		createdAt: c.createdAt.toISOString()
	}));

	// Uten conversation-param: vis kun liste
	if (!conversationId) {
		return { conversations, userThemes, selectedConversation: null, messages: [] };
	}

	const verifiedConversation = await getConversationByIdForUser(conversationId, locals.userId);
	if (!verifiedConversation) {
		throw redirect(302, '/samtaler');
	}

	const selectedConversation = conversations.find((c) => c.id === conversationId) ?? null;
	const msgs = await getConversationMessages(conversationId);

	return {
		conversations,
		userThemes,
		selectedConversation,
		messages: msgs.map((m) => ({
			id: m.id,
			role: m.role as 'user' | 'assistant' | 'system',
			content: m.content,
			starred: m.starred,
			timestamp: m.createdAt.toISOString(),
			imageUrl: m.imageUrl,
			widgetProposal: (m.metadata as { widgetProposal?: unknown } | null)?.widgetProposal ?? null,
			widgetFlow: (m.metadata as { widgetFlow?: unknown } | null)?.widgetFlow ?? null,
			statusWidget: (m.metadata as { statusWidget?: unknown } | null)?.statusWidget ?? null,
			photoAnnotation: (m.metadata as { photoAnnotation?: unknown } | null)?.photoAnnotation ?? null,
			photoAnnotationImageUrl: (m.metadata as { photoAnnotationImageUrl?: unknown } | null)?.photoAnnotationImageUrl ?? null
		}))
	};
};
