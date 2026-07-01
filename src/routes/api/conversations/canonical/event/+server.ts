import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addCanonicalEventMessage } from '$lib/server/conversations';
import { ensureUser } from '$lib/server/users';
import type { ChatEventCard, ChatEventCardKind } from '$lib/chat/event-cards';

const VALID_KINDS: ChatEventCardKind[] = ['checkin', 'workout', 'nudge', 'flow', 'generic'];

/**
 * Poster et inline hendelseskort inn i den kanoniske «dagbok»-tråden. Lar klient-flyter
 * (f.eks. dagsavslutning) legge igjen relevante hendelser i dagboken.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		if (!locals.userId) return json({ error: 'Unauthorized' }, { status: 401 });

		const body = await request.json().catch(() => null);
		const title = typeof body?.title === 'string' ? body.title.trim() : '';
		if (!title) return json({ error: 'title er påkrevd' }, { status: 400 });

		const kind: ChatEventCardKind = VALID_KINDS.includes(body?.kind) ? body.kind : 'generic';
		const card: ChatEventCard = {
			kind,
			title,
			icon: typeof body?.icon === 'string' ? body.icon : undefined,
			detail: typeof body?.detail === 'string' ? body.detail : null,
			href: typeof body?.href === 'string' ? body.href : null
		};

		await ensureUser(locals.userId);
		const message = await addCanonicalEventMessage(locals.userId, card);
		return json({ success: true, messageId: message.id });
	} catch (error) {
		console.error('Error posting canonical event:', error);
		return json({ error: 'Failed to post canonical event' }, { status: 500 });
	}
};
