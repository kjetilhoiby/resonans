import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOrCreatePlanningGoal } from '$lib/server/goals';
import { db } from '$lib/db';
import { goals } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const goalId = await getOrCreatePlanningGoal(userId);
	const [goal] = await db.select({ id: goals.id, title: goals.title }).from(goals).where(eq(goals.id, goalId));

	return json({ id: goalId, title: goal?.title ?? 'Planlegging' });
};
