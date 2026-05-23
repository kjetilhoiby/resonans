import { listInboxItems } from '$lib/server/inbox';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const [items, userThemes] = await Promise.all([
		listInboxItems(locals.userId),
		db.query.themes.findMany({
			where: and(eq(themes.userId, locals.userId), eq(themes.archived, false)),
			columns: { id: true, name: true, emoji: true, parentTheme: true }
		})
	]);

	return {
		items: items.map((i) => ({
			...i,
			createdAt: i.createdAt.toISOString()
		})),
		themes: userThemes
	};
};
