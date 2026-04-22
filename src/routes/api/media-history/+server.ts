import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { messages } from '$lib/db/schema';
import { desc } from 'drizzle-orm';

type AttachmentKind = 'image' | 'audio' | 'document' | 'other';

interface MediaHistoryItem {
	id: string;
	kind: AttachmentKind;
	name: string;
	url: string;
	mimeType?: string;
	note?: string;
	source?: 'camera' | 'file' | 'voice' | 'sheet';
	createdAt: string;
}

export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const kind = url.searchParams.get('kind') as AttachmentKind | null;
	const maxResults = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 50);

	if (!userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	if (!kind || !['image', 'audio', 'document', 'other'].includes(kind)) {
		return json({ error: 'Invalid or missing kind parameter' }, { status: 400 });
	}

	try {
		// Nu må vi filter manuelt siden vi ikke har direkte access til userId via messages
		// Vi må join med conversations
		const { conversations } = await import('$lib/db/schema');
		const { eq: dEq, and: dAnd } = await import('drizzle-orm');

		const messagesWithAttachments = await db
			.select({
				id: messages.id,
				metadata: messages.metadata,
				createdAt: messages.createdAt
			})
			.from(messages)
			.innerJoin(conversations, dEq(messages.conversationId, conversations.id))
			.where(dAnd(dEq(conversations.userId, userId)))
			.orderBy(desc(messages.createdAt))
			.limit(maxResults * 2); // Get more to filter

		const mediaItems: MediaHistoryItem[] = [];

		for (const row of messagesWithAttachments) {
			if (!row.metadata) continue;

			const meta = row.metadata as Record<string, unknown>;
			const attachment = meta.attachment;

			if (!attachment || typeof attachment !== 'object') continue;

			const att = attachment as Record<string, unknown>;
			if (att.kind !== kind) continue;

			if (typeof att.url === 'string' && typeof att.name === 'string') {
				mediaItems.push({
					id: row.id,
					kind: kind,
					name: att.name as string,
					url: att.url as string,
					mimeType: typeof att.mimeType === 'string' ? att.mimeType : undefined,
					note: typeof att.note === 'string' ? att.note : undefined,
					source: att.source as any,
					createdAt: row.createdAt.toISOString()
				});

				if (mediaItems.length >= maxResults) break;
			}
		}

		return json({ mediaHistory: mediaItems });
	} catch (error) {
		console.error('Error fetching media history:', error);
		return json({ error: 'Failed to fetch media history' }, { status: 500 });
	}
};
