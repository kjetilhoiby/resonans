import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOrCreateCanonicalConversation } from '$lib/server/conversations';
import { ensureUser } from '$lib/server/users';

/**
 * Returnerer den kanoniske «dagbok»-tråden for brukeren og oppretter den ved behov.
 * Hjem-chatten bruker dette som getOrCreateConversationId slik at all fri chat
 * akkumulerer i én ryggrad-tråd i stedet for å lage en ny samtale hver gang.
 */
export const POST: RequestHandler = async ({ locals }) => {
	try {
		if (!locals.userId) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}
		await ensureUser(locals.userId);
		const conversation = await getOrCreateCanonicalConversation(locals.userId);
		return json({
			success: true,
			conversationId: conversation.id,
			title: conversation.title
		});
	} catch (error) {
		console.error('Error resolving canonical conversation:', error);
		return json({ error: 'Failed to resolve canonical conversation' }, { status: 500 });
	}
};
