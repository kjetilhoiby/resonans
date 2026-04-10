import { db } from '$lib/db';
import { trackingSeries } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { ensureUser } from '$lib/server/users';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	await ensureUser(locals.userId);
	const userId = locals.userId;

	const series = await db.query.trackingSeries.findMany({
		where: and(
			eq(trackingSeries.userId, userId)
		),
		with: { recordType: true },
		orderBy: (t, { desc }) => [desc(t.updatedAt)]
	});

	return { series };
};
