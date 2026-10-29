import { json } from '@sveltejs/kit';
import { getConversationByIdForUser } from '$lib/server/conversations';
import { DirectionError, saveDirectionConversation } from '$lib/server/direction/direction-conversation';
import type { RequestHandler } from './$types';

/**
 * Lagrer retningssamtalen fra flyten i appen. Lagringen bor i
 * `saveDirectionConversation`, delt med MCP-verktøyet — skriv aldri en andre.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	const body = await request.json();

	// Rå-samtalen i messages-tabellen — valideres før kobling
	const rawConversationId = typeof body?.conversationId === 'string' ? body.conversationId : '';
	const conversation = rawConversationId ? await getConversationByIdForUser(rawConversationId, userId) : null;

	try {
		const saved = await saveDirectionConversation(userId, {
			gap: typeof body?.gap === 'string' ? body.gap : '',
			vision: typeof body?.visjon === 'string' ? body.visjon : '',
			transcript: typeof body?.transcript === 'string' ? body.transcript : '',
			conversationId: conversation?.id ?? null,
			origin: 'app'
		});
		return json({ ok: true, periodKey: saved.periodKey, savedVision: Boolean(saved.visionId) });
	} catch (error) {
		if (error instanceof DirectionError) return json({ error: 'Tom samtale' }, { status: 400 });
		throw error;
	}
};
