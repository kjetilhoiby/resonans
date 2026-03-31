import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations } from '$lib/db/schema';
import { ensureConversationThemeIdColumn } from '$lib/server/conversation-schema';
import { ensureUser } from '$lib/server/users';

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		await ensureUser(locals.userId);
		await ensureConversationThemeIdColumn();

		let requestedTitle: string | null = null;
		let requestedKind: 'default' | 'book' = 'default';

		try {
			// Optional payload allows clients to create book-specific conversation threads.
			const body = await request.json();
			if (body && typeof body === 'object') {
				const payload = body as { title?: unknown; kind?: unknown };
				if (typeof payload.title === 'string' && payload.title.trim().length > 0) {
					requestedTitle = payload.title.trim();
				}
				if (payload.kind === 'book') {
					requestedKind = 'book';
				}
			}
		} catch {
			// Fall back to default title when no JSON body is provided.
		}

		const defaultTitle = `Ny samtale - ${new Date().toLocaleDateString('no-NO')}`;
		const title = requestedTitle
			? requestedKind === 'book'
				? `📚 ${requestedTitle}`
				: requestedTitle
			: defaultTitle;

		// Opprett ny samtale
		const [newConversation] = await db.insert(conversations).values({
			userId: locals.userId,
			title
		}).returning();

		return json({ 
			success: true,
			title: newConversation.title,
			conversationId: newConversation.id 
		});
	} catch (error) {
		console.error('Error creating new conversation:', error);
		return json(
			{ error: 'Failed to create new conversation' },
			{ status: 500 }
		);
	}
};
