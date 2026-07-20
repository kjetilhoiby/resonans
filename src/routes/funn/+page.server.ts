import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { finds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
	const rows = await db.query.finds.findMany({
		where: eq(finds.userId, locals.userId),
		orderBy: (f, { desc }) => [desc(f.createdAt)],
		limit: 300
	});

	return {
		finds: rows.map((row) => ({
			id: row.id,
			title: row.title,
			summary: row.summary,
			theme: row.theme,
			kind: row.kind,
			sourceUrl: row.sourceUrl,
			thumbnailUrl: row.thumbnailUrl,
			status: row.status,
			mealId: row.mealId,
			emailFrom: row.emailFrom,
			createdAt: row.createdAt.toISOString()
		}))
	};
};
