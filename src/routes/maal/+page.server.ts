import { db } from '$lib/db';
import { goals } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userGoals = await db.query.goals.findMany({
		where: eq(goals.userId, locals.userId),
		with: {
			tasks: {
				with: {
					progress: {
						orderBy: (progress, { desc }) => [desc(progress.completedAt)],
						limit: 5
					}
				},
				where: (tasks, { eq }) => eq(tasks.status, 'active')
			}
		},
		orderBy: (goals, { desc }) => [desc(goals.createdAt)]
	});

	return { goals: userGoals };
};
