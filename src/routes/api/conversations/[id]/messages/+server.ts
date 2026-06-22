import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { messages, conversations } from '$lib/db/schema';
import { and, eq, asc } from 'drizzle-orm';
import { ensureConversationThemeIdColumn } from '$lib/server/conversation-schema';
import { getConversationMessagesPage } from '$lib/server/conversations';
import type { RequestHandler } from './$types';

type MessageRow = typeof messages.$inferSelect;

function serialize(m: MessageRow) {
	const meta = m.metadata as Record<string, unknown> | null;
	return {
		id: m.id,
		role: m.role,
		content: m.content,
		starred: m.starred,
		timestamp: m.createdAt.toISOString(),
		imageUrl: m.imageUrl,
		widgetProposal: meta?.widgetProposal ?? null,
		widgetFlow: meta?.widgetFlow ?? null,
		statusWidget: meta?.statusWidget ?? null,
		photoAnnotation: meta?.photoAnnotation ?? null,
		photoAnnotationImageUrl: meta?.photoAnnotationImageUrl ?? null
	};
}

export const GET: RequestHandler = async ({ params, locals, url }) => {
	await ensureConversationThemeIdColumn();

	const conv = await db.query.conversations.findFirst({
		where: and(eq(conversations.id, params.id), eq(conversations.userId, locals.userId))
	});
	if (!conv) error(404, 'Samtale ikke funnet');

	// Paginert modus (infinite scroll): ?limit=N&before=<ISO-timestamp>
	const limitParam = url.searchParams.get('limit');
	if (limitParam) {
		const limit = Math.min(Math.max(parseInt(limitParam, 10) || 0, 1), 100);
		const beforeParam = url.searchParams.get('before');
		const before = beforeParam ? new Date(beforeParam) : undefined;
		const { messages: page, hasMore } = await getConversationMessagesPage(params.id, { limit, before });

		return json(
			page.filter((m) => m.role !== 'system').map(serialize),
			{ headers: { 'X-Has-More': hasMore ? '1' : '0' } }
		);
	}

	// Bakoverkompatibel modus: alle meldinger, kronologisk.
	const msgs = await db.query.messages.findMany({
		where: eq(messages.conversationId, params.id),
		orderBy: [asc(messages.createdAt)]
	});

	return json(msgs.filter((m) => m.role !== 'system').map(serialize));
};
