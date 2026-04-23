import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getUserConversationList } from '$lib/server/conversations';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const t0 = Date.now();
	console.log('[home] load start, userId:', locals.userId);

	const [activeThemes, conversationList] = await Promise.all([
		db
			.select({
				id: themes.id,
				name: themes.name,
				emoji: themes.emoji,
			})
			.from(themes)
			.where(and(eq(themes.userId, locals.userId), eq(themes.archived, false))),
		getUserConversationList(locals.userId, { limit: 6 })
	]);

	console.log('[home] db done in', Date.now() - t0, 'ms — themes:', activeThemes.length, 'convs:', conversationList.length);

	const recentConversations = conversationList.map((c) => ({
		id: c.id,
		title: c.title,
		preview: c.preview,
		updatedAt: c.updatedAt.toISOString()
	}));

	console.log('[home] load done in', Date.now() - t0, 'ms');
	return { themes: activeThemes, recentConversations };
};
