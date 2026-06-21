import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	deleteCoachConversation,
	getOwnedConversation,
	loadConversationTurns
} from '$lib/server/programs/coach-conversation';

/**
 * GET /api/apps/coach/conversations/{conversationId}
 *
 * Gjenopprett en tråd for visning (etter reinstall / på ny enhet). Returnerer turene i
 * kronologisk rekkefølge. 404 hvis tråden ikke finnes eller ikke eies av token-brukeren.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const owned = await getOwnedConversation(userId, params.id);
	if (!owned) {
		return json({ error: 'Conversation not found', code: 'conversation_not_found' }, { status: 404 });
	}

	const turns = await loadConversationTurns(owned.id);
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
 * DELETE /api/apps/coach/conversations/{conversationId}
 *
 * Personvern: «glem samtalen». Sletter tråden (og turene via cascade) server-side.
 * 404 hvis tråden ikke finnes eller ikke eies av brukeren.
 */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const deleted = await deleteCoachConversation(userId, params.id);
	if (!deleted) {
		return json({ error: 'Conversation not found', code: 'conversation_not_found' }, { status: 404 });
	}

	return json({ ok: true });
};
