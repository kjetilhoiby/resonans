import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	deleteAssistantConversation,
	getOwnedAssistantConversation,
	loadAssistantTurns
} from '$lib/server/assistant/conversation';

/**
 * GET /api/apps/assistant/conversations/{conversationId}
 *
 * Gjenopprett en assistent-tråd for visning. Returnerer turene kronologisk. 404 hvis tråden
 * ikke finnes, ikke eies av token-brukeren, eller ikke er en assistent-tråd.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const owned = await getOwnedAssistantConversation(userId, params.id);
	if (!owned) {
		return json({ error: 'Conversation not found', code: 'conversation_not_found' }, { status: 404 });
	}

	const turns = await loadAssistantTurns(owned.id);
	return json({
		ok: true,
		conversationId: owned.id,
		title: owned.title ?? 'Samtale',
		messages: turns.map((t) => ({
			role: t.role,
			text: t.text,
			timestamp: t.timestamp.toISOString()
		}))
	});
};

/**
 * DELETE /api/apps/assistant/conversations/{conversationId}
 *
 * Personvern: «glem samtalen». Sletter assistent-tråden (og turene via cascade) server-side.
 * 404 hvis tråden ikke finnes, ikke eies, eller ikke er en assistent-tråd.
 */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const deleted = await deleteAssistantConversation(userId, params.id);
	if (!deleted) {
		return json({ error: 'Conversation not found', code: 'conversation_not_found' }, { status: 404 });
	}

	return json({ ok: true });
};
