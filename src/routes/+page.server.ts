import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getUserConversationList } from '$lib/server/conversations';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const activeThemes = await db
		.select({
			id: themes.id,
			name: themes.name,
			emoji: themes.emoji,
		})
		.from(themes)
		.where(and(eq(themes.userId, locals.userId), eq(themes.archived, false)));

	const conversationList = await getUserConversationList(locals.userId);
	const recentConversations = conversationList.slice(0, 6).map((c) => ({
		id: c.id,
		title: c.title,
		preview: c.preview,
		updatedAt: c.updatedAt.toISOString()
	}));

	return { themes: activeThemes, recentConversations };
};
