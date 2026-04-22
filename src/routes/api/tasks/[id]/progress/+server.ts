import { db } from '$lib/db';
import { tasks } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { json, error } from '@sveltejs/kit';
import { TaskExecutionService } from '$lib/server/services/task-execution-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { id } = params;
	const userId = locals.userId;

	// Verify the task belongs to a goal owned by this user
	const task = await db.query.tasks.findFirst({
		where: eq(tasks.id, id),
		with: {
			goal: { columns: { userId: true } }
		}
	});

	const goalOwnerId = Array.isArray(task?.goal) ? task?.goal[0]?.userId : task?.goal?.userId;

	if (!task || goalOwnerId !== userId) {
		throw error(404, 'Oppgave ikke funnet');
	}

	const body = await request.json().catch(() => ({}));
	const value = typeof body?.value === 'number' ? body.value : null;
	const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : null;

	const record = await TaskExecutionService.recordTaskProgress({
		taskId: id,
		userId,
		value,
		note,
		completedAt: new Date()
	});

	return json({ id: record.id, completedAt: record.completedAt }, { status: 201 });
};
