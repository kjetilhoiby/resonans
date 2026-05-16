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
		let sourceContext: {
			sourceTaskId?: string;
			sourceChecklistId?: string;
			sourceItemId?: string;
			sourceItemText?: string;
		} | null = null;

		try {
			const body = await request.json();
			if (body && typeof body === 'object') {
				const payload = body as { title?: unknown; kind?: unknown; sourceContext?: unknown };
				if (typeof payload.title === 'string' && payload.title.trim().length > 0) {
					requestedTitle = payload.title.trim();
				}
				if (payload.kind === 'book') {
					requestedKind = 'book';
				}
				if (payload.sourceContext && typeof payload.sourceContext === 'object') {
					const sc = payload.sourceContext as Record<string, unknown>;
					sourceContext = {
						...(typeof sc.sourceTaskId === 'string' ? { sourceTaskId: sc.sourceTaskId } : {}),
						...(typeof sc.sourceChecklistId === 'string' ? { sourceChecklistId: sc.sourceChecklistId } : {}),
						...(typeof sc.sourceItemId === 'string' ? { sourceItemId: sc.sourceItemId } : {}),
						...(typeof sc.sourceItemText === 'string' ? { sourceItemText: sc.sourceItemText } : {})
					};
					if (Object.keys(sourceContext).length === 0) sourceContext = null;
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

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const newConversation = ((await db.insert(conversations).values({
			userId: locals.userId,
			title,
			...(sourceContext ? { metadata: sourceContext } : {})
		}).returning()) as any[])[0];

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
