import { db } from '$lib/db';
import { themes, goals, messages as messagesTable, conversations } from '$lib/db/schema';
import { loadHealthDashboardData } from '$lib/server/health-dashboard';
import { loadEconomicsDashboardData } from '$lib/server/economics-dashboard';
import { getThemeInstruction } from '$lib/server/theme-instructions';
import { ensureConversationThemeIdColumn } from '$lib/server/conversation-schema';
import { getConversationsByTheme } from '$lib/server/conversations';
import { eq, and, asc } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	await ensureConversationThemeIdColumn();

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
			.values({ userId: locals.userId, themeId: theme.id, title: theme.name })
			.returning({ id: conversations.id });
		await db
			.update(themes)
			.set({ conversationId: conv.id })
			.where(eq(themes.id, theme.id));
		conversationId = conv.id;
	} else {
		// Retroaktivt: koble eksisterende canonical samtale til temaet om den mangler themeId
		const existingConv = await db.query.conversations.findFirst({
			where: eq(conversations.id, conversationId)
		});
		if (existingConv && !existingConv.themeId) {
			await db.update(conversations)
				.set({ themeId: theme.id })
				.where(eq(conversations.id, conversationId));
		}
	}

	// Last alle samtaler for dette temaet
	const themeConversations = await getConversationsByTheme(locals.userId, theme.id);

	// Last meldinger for den valgte/canonicale samtalen
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

	const isHealthTheme = theme.name.trim().toLowerCase() === 'helse';
	const isEconomicsTheme = theme.name.trim().toLowerCase() === 'økonomi';
	const healthDashboard = isHealthTheme ? await loadHealthDashboardData(locals.userId) : null;
	const economicsDashboard = isEconomicsTheme ? await loadEconomicsDashboardData(locals.userId) : null;
	const instruction = await getThemeInstruction(locals.userId, theme.id);

	return {
		theme: {
			id: theme.id,
			name: theme.name,
			emoji: theme.emoji,
			description: theme.description
		},
		themeConversations: themeConversations.map((c) => ({
			...c,
			updatedAt: c.updatedAt.toISOString(),
			createdAt: c.createdAt.toISOString()
		})),
		messages: msgs.map((m) => ({
			id: m.id,
			role: m.role as 'user' | 'assistant' | 'system',
			content: m.content,
			timestamp: m.timestamp.toISOString()
		})),
		goals: themeGoals,
		conversationId,
		healthDashboard,
		economicsDashboard,
		themeInstruction: instruction
	};
};
