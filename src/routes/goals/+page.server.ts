import { db } from '$lib/db';
import { goals } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { DEFAULT_USER_ID } from '$lib/server/users';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const userGoals = await db.query.goals.findMany({
		where: eq(goals.userId, DEFAULT_USER_ID),
		with: {
			category: true,
			tasks: true
		},
		orderBy: (goals, { desc }) => [desc(goals.createdAt)]
	});

	return {
		goals: userGoals
	};
};
