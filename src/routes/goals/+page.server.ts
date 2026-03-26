import { db } from '$lib/db';
import { goals } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userGoals = await db.query.goals.findMany({
		where: eq(goals.userId, locals.userId),
		with: {
			category: true,
			tasks: {
				with: {
					progress: {
						with: {
							activity: {
								with: {
									metrics: true
								}
							}
						},
						orderBy: (progress, { desc }) => [desc(progress.completedAt)],
						limit: 10
					}
				}
			}
		},
		orderBy: (goals, { desc }) => [desc(goals.createdAt)]
	});

	return {
		goals: userGoals
	};
};
