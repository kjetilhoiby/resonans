import { db } from '$lib/db';
import { themes, goals, messages as messagesTable, conversations, themeFiles, themeLists } from '$lib/db/schema';
import { getThemeInstruction } from '$lib/server/theme-instructions';
import { ensureConversationThemeIdColumn } from '$lib/server/conversation-schema';
import { getConversationsByTheme } from '$lib/server/conversations';
import { getWorkoutContextForUser } from '$lib/server/workout-context';
import { eq, and, asc } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	await ensureConversationThemeIdColumn();
	const selectedWorkoutId = url.searchParams.get('workout');

	// Sjekk om params.id er en UUID (inneholder bindestreker og er 36 tegn)
	const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id);
	
	let theme;
	if (isUUID) {
		// Finn tema basert på UUID
		theme = await db.query.themes.findFirst({
			where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId))
		});
	} else {
		// Finn tema basert på navn (for URL-er som /tema/helse)
		const themeName = params.id.charAt(0).toUpperCase() + params.id.slice(1);
		theme = await db.query.themes.findFirst({
			where: and(eq(themes.name, themeName), eq(themes.userId, locals.userId))
		});
	}

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

	const instruction = await getThemeInstruction(locals.userId, theme.id);
	const uploadedFiles = await db
		.select()
		.from(themeFiles)
		.where(and(eq(themeFiles.themeId, theme.id), eq(themeFiles.userId, locals.userId)))
		.orderBy(asc(themeFiles.createdAt));
	const tripListsRaw = await db.query.themeLists.findMany({
		where: and(eq(themeLists.themeId, theme.id), eq(themeLists.userId, locals.userId)),
		with: { items: { orderBy: (i, { asc: a }) => [a(i.sortOrder), a(i.createdAt)] } },
		orderBy: [asc(themeLists.sortOrder), asc(themeLists.createdAt)]
	});
	const selectedWorkout = selectedWorkoutId
		? await getWorkoutContextForUser(locals.userId, selectedWorkoutId)
		: null;

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
		themeInstruction: instruction,
		themeFiles: uploadedFiles.map((f) => ({
			id: f.id,
			name: f.name,
			url: f.url,
			fileType: f.fileType,
			mimeType: f.mimeType,
			sizeBytes: f.sizeBytes,
			createdAt: f.createdAt.toISOString()
		})),
		tripProfile: theme.tripProfile ?? null,
		tripLists: tripListsRaw.map((l) => ({
			id: l.id,
			title: l.title,
			emoji: l.emoji,
			listType: l.listType,
			sortOrder: l.sortOrder,
			items: l.items.map((i) => ({
				id: i.id,
				text: i.text,
				checked: i.checked ?? false,
				notes: i.notes ?? null,
				itemDate: i.itemDate ?? null,
				sortOrder: i.sortOrder
			}))
		})),
		selectedWorkout
	};
};
