import { redirect } from '@sveltejs/kit';
import { getConversationByIdForUser, getConversationMessages, getUserConversationList } from '$lib/server/conversations';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const conversationId = url.searchParams.get('conversation');
	const conversationList = await getUserConversationList(locals.userId);

	const conversations = conversationList.map((c) => ({
		...c,
		updatedAt: c.updatedAt.toISOString(),
		createdAt: c.createdAt.toISOString()
	}));

	// Uten conversation-param: vis kun liste
	if (!conversationId) {
		return { conversations, selectedConversation: null, messages: [] };
	}

	const verifiedConversation = await getConversationByIdForUser(conversationId, locals.userId);
	if (!verifiedConversation) {
		throw redirect(302, '/samtaler');
	}

	const selectedConversation = conversations.find((c) => c.id === conversationId) ?? null;
	const msgs = await getConversationMessages(conversationId);

	return {
		conversations,
		selectedConversation,
		messages: msgs.map((m) => ({
			id: m.id,
			role: m.role as 'user' | 'assistant' | 'system',
			content: m.content,
			timestamp: m.createdAt.toISOString(),
			imageUrl: m.imageUrl,
			widgetProposal: (m.metadata as { widgetProposal?: unknown } | null)?.widgetProposal ?? null,
			statusWidget: (m.metadata as { statusWidget?: unknown } | null)?.statusWidget ?? null,
			photoAnnotation: (m.metadata as { photoAnnotation?: unknown } | null)?.photoAnnotation ?? null,
			photoAnnotationImageUrl: (m.metadata as { photoAnnotationImageUrl?: unknown } | null)?.photoAnnotationImageUrl ?? null
		}))
	};
};
