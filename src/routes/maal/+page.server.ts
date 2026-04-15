import { db } from '$lib/db';
import { goals, trackingSeries } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const [userGoals, allSeries] = await Promise.all([
		db.query.goals.findMany({
			where: eq(goals.userId, locals.userId),
			with: {
				category: true,
				theme: { columns: { name: true, emoji: true } },
				tasks: {
					with: {
						trackingSeries: {
							with: { recordType: true },
							where: (s, { eq: eqS }) => eqS(s.status, 'active')
						}
					}
				}
			},
			orderBy: (g, { desc }) => [desc(g.createdAt)]
		}),
		db.query.trackingSeries.findMany({
			where: eq(trackingSeries.userId, locals.userId),
			with: { recordType: true },
			orderBy: (s, { desc }) => [desc(s.updatedAt)]
		})
	]);

	return { goals: userGoals, allSeries };
};
