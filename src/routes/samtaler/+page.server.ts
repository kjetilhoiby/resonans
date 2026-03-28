import { redirect } from '@sveltejs/kit';
import { getConversationByIdForUser, getConversationMessages, getUserConversationList } from '$lib/server/conversations';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const conversationId = url.searchParams.get('conversation');
	const conversations = await getUserConversationList(locals.userId);

	let selectedConversation =
		conversationId && typeof conversationId === 'string'
			? conversations.find((conversation) => conversation.id === conversationId) ?? null
			: conversations[0] ?? null;

	if (!selectedConversation && conversations.length === 0) {
		return {
			conversations: [],
			selectedConversation: null,
			messages: []
		};
	}

	if (!selectedConversation && conversations.length > 0) {
		selectedConversation = conversations[0];
	}

	if (!selectedConversation) {
		throw redirect(302, '/');
	}

	const verifiedConversation = await getConversationByIdForUser(selectedConversation.id, locals.userId);
	if (!verifiedConversation) {
		throw redirect(302, '/samtaler');
	}

	const messages = await getConversationMessages(selectedConversation.id);

	return {
		conversations: conversations.map((conversation) => ({
			...conversation,
			updatedAt: conversation.updatedAt.toISOString(),
			createdAt: conversation.createdAt.toISOString()
		})),
		selectedConversation: {
			...selectedConversation,
			updatedAt: selectedConversation.updatedAt.toISOString(),
			createdAt: selectedConversation.createdAt.toISOString()
		},
		messages: messages.map((message) => ({
			id: message.id,
			role: message.role as 'user' | 'assistant' | 'system',
			content: message.content,
			timestamp: message.createdAt.toISOString(),
			imageUrl: message.imageUrl
		}))
	};
};
