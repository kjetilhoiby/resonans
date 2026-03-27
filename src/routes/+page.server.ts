import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
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

	return { themes: activeThemes };
};
