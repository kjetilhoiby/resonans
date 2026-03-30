import { db } from '$lib/db';
import { conversations, themes } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { ensureConversationThemeIdColumn } from '$lib/server/conversation-schema';

interface EnsureThemeInput {
	userId: string;
	name: string;
	emoji?: string;
	description?: string;
	parentTheme?: string | null;
}

export async function ensureThemeForUser({
	userId,
	name,
	emoji = '📁',
	description,
	parentTheme = null
}: EnsureThemeInput) {
	await ensureConversationThemeIdColumn();

	const existingTheme = await db.query.themes.findFirst({
		where: and(eq(themes.userId, userId), eq(themes.name, name))
	});

	if (existingTheme) {
		let conversationId = existingTheme.conversationId;

		if (!conversationId) {
			const [newConversation] = await db.insert(conversations).values({
				userId,
				title: `${existingTheme.emoji || emoji} ${existingTheme.name}`
			}).returning();
			conversationId = newConversation.id;
		}

		const [updatedTheme] = await db
			.update(themes)
			.set({
				emoji: existingTheme.emoji || emoji,
				description: existingTheme.description || description,
				parentTheme: existingTheme.parentTheme || parentTheme,
				conversationId,
				archived: false,
				updatedAt: new Date()
			})
			.where(eq(themes.id, existingTheme.id))
			.returning();

		return {
			theme: updatedTheme,
			created: false
		};
	}

	const [conversation] = await db.insert(conversations).values({
		userId,
		title: `${emoji} ${name}`
	}).returning();

	const [theme] = await db.insert(themes).values({
		userId,
		name,
		emoji,
		description,
		parentTheme,
		conversationId: conversation.id,
		archived: false,
		aiSuggested: false
	}).returning();

	return {
		theme,
		created: true
	};
}