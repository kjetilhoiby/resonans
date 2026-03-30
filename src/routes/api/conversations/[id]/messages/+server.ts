import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { messages, conversations } from '$lib/db/schema';
import { and, eq, asc } from 'drizzle-orm';
import { ensureConversationThemeIdColumn } from '$lib/server/conversation-schema';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	await ensureConversationThemeIdColumn();

	const conv = await db.query.conversations.findFirst({
		where: and(eq(conversations.id, params.id), eq(conversations.userId, locals.userId))
	});
	if (!conv) error(404, 'Samtale ikke funnet');

	const msgs = await db.query.messages.findMany({
		where: eq(messages.conversationId, params.id),
		orderBy: [asc(messages.createdAt)]
	});

	return json(
		msgs
			.filter((m) => m.role !== 'system')
			.map((m) => ({
				id: m.id,
				role: m.role,
				content: m.content,
				timestamp: m.createdAt.toISOString()
			}))
	);
};
