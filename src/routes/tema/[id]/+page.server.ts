import { db } from '$lib/db';
import { themes, goals, messages as messagesTable, conversations } from '$lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId))
	});

	if (!theme) {
		error(404, 'Tema ikke funnet');
	}

	// Opprett samtale for temaet om det mangler
	let conversationId = theme.conversationId;
	if (!conversationId) {
		const [conv] = await db
			.insert(conversations)
			.values({ userId: locals.userId, title: theme.name })
			.returning();
		await db
			.update(themes)
			.set({ conversationId: conv.id })
			.where(eq(themes.id, theme.id));
		conversationId = conv.id;
	}

	// Last meldinger for denne samtalen (nyeste 50, i kronologisk rekkefølge)
	const msgs = await db
		.select({
			id: messagesTable.id,
			role: messagesTable.role,
			content: messagesTable.content,
			timestamp: messagesTable.createdAt
		})
		.from(messagesTable)
		.where(eq(messagesTable.conversationId, conversationId))
		.orderBy(asc(messagesTable.createdAt))
		.limit(50);

	// Last aktive mål for dette temaet
	const themeGoals = await db
		.select({
			id: goals.id,
			title: goals.title,
			status: goals.status,
			description: goals.description
		})
		.from(goals)
		.where(
			and(
				eq(goals.themeId, theme.id),
				eq(goals.userId, locals.userId)
			)
		);

	return {
		theme: {
			id: theme.id,
			name: theme.name,
			emoji: theme.emoji,
			description: theme.description
		},
		messages: msgs.map((m) => ({
			id: m.id,
			role: m.role as 'user' | 'assistant' | 'system',
			content: m.content,
			timestamp: m.timestamp.toISOString()
		})),
		goals: themeGoals,
		conversationId
	};
};
