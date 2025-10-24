import { json, type RequestEvent } from '@sveltejs/kit';
import { db } from '$lib/db';
import { goals, tasks, progress } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { DEFAULT_USER_ID } from '$lib/server/users';

export const DELETE = async ({ url }: RequestEvent) => {
	try {
		const goalId = url.searchParams.get('id');

		if (!goalId) {
			return json({ error: 'Goal ID is required' }, { status: 400 });
		}

		// Verifiser at målet tilhører brukeren
		const goal = await db.query.goals.findFirst({
			where: eq(goals.id, goalId)
		});

		if (!goal) {
			return json({ error: 'Goal not found' }, { status: 404 });
		}

		if (goal.userId !== DEFAULT_USER_ID) {
			return json({ error: 'Unauthorized' }, { status: 403 });
		}

		// Hent alle tasks for dette målet
		const goalTasks = await db.query.tasks.findMany({
			where: eq(tasks.goalId, goalId)
		});

		// Slett all progress for tasks
		for (const task of goalTasks) {
			await db.delete(progress).where(eq(progress.taskId, task.id));
		}

		// Slett alle tasks
		await db.delete(tasks).where(eq(tasks.goalId, goalId));

		// Slett målet
		await db.delete(goals).where(eq(goals.id, goalId));

		return json({ success: true, message: 'Målet er slettet' });
	} catch (error) {
		console.error('Error deleting goal:', error);
		return json({ error: 'Failed to delete goal' }, { status: 500 });
	}
};
