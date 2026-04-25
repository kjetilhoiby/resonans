import { error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { messages as messagesTable } from '$lib/db/schema';
import { asc, eq } from 'drizzle-orm';
import { getProjectTree } from '$lib/server/goals';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const tree = await getProjectTree(params.id, locals.userId);
	if (!tree) error(404, 'Oppgave ikke funnet');

	let chatMessages: Array<{ id: string; role: 'user' | 'assistant' | 'system'; content: string; timestamp: string }> = [];
	if (tree.conversationId) {
		const msgs = await db
			.select({
				id: messagesTable.id,
				role: messagesTable.role,
				content: messagesTable.content,
				timestamp: messagesTable.createdAt
			})
			.from(messagesTable)
			.where(eq(messagesTable.conversationId, tree.conversationId))
			.orderBy(asc(messagesTable.createdAt))
			.limit(50);
		chatMessages = msgs.map((m) => ({
			id: m.id,
			role: m.role as 'user' | 'assistant' | 'system',
			content: m.content,
			timestamp: m.timestamp.toISOString()
		}));
	}

	return {
		project: {
			id: tree.id,
			goalId: tree.goalId,
			title: tree.title,
			description: tree.description,
			status: tree.status,
			startDate: tree.startDate ? tree.startDate.toISOString() : null,
			dueDate: tree.dueDate ? tree.dueDate.toISOString() : null,
			conversationId: tree.conversationId,
			children: tree.children.map((child) => ({
				id: child.id,
				title: child.title,
				description: child.description,
				status: child.status,
				sortOrder: child.sortOrder,
				progressCount: child.progress?.length ?? 0,
				createdAt: child.createdAt.toISOString()
			})),
			files: tree.files.map((f) => ({
				id: f.id,
				name: f.name,
				url: f.url,
				fileType: f.fileType,
				mimeType: f.mimeType,
				sizeBytes: f.sizeBytes,
				createdAt: f.createdAt.toISOString()
			}))
		},
		chatMessages
	};
};
