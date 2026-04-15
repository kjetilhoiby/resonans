import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { tasks, trackingSeries } from '$lib/db/schema';
import { and, eq, ne } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json();
	const { taskId, seriesId } = body as { taskId?: string; seriesId?: string | null };

	if (!taskId || typeof taskId !== 'string') {
		return json({ error: 'taskId is required' }, { status: 400 });
	}

	// Verify the task belongs to the user (via goal ownership)
	const task = await db.query.tasks.findFirst({
		where: eq(tasks.id, taskId),
		with: { goal: { columns: { userId: true } } }
	});

	if (!task || (task.goal as { userId: string }).userId !== userId) {
		return json({ error: 'Task not found' }, { status: 404 });
	}

	const targetSeriesId = typeof seriesId === 'string' && seriesId ? seriesId : null;

	if (targetSeriesId) {
		// Verify series belongs to user
		const series = await db.query.trackingSeries.findFirst({
			where: and(eq(trackingSeries.id, targetSeriesId), eq(trackingSeries.userId, userId))
		});
		if (!series) {
			return json({ error: 'Tracking series not found' }, { status: 404 });
		}
	}

	// Clear taskId from any OTHER series that currently point at this task
	const clearWhere = targetSeriesId
		? and(eq(trackingSeries.userId, userId), eq(trackingSeries.taskId, taskId), ne(trackingSeries.id, targetSeriesId))
		: and(eq(trackingSeries.userId, userId), eq(trackingSeries.taskId, taskId));

	await db.update(trackingSeries).set({ taskId: null, updatedAt: new Date() }).where(clearWhere);

	// Set the new link
	if (targetSeriesId) {
		await db
			.update(trackingSeries)
			.set({ taskId, updatedAt: new Date() })
			.where(and(eq(trackingSeries.id, targetSeriesId), eq(trackingSeries.userId, userId)));
	}

	return json({ success: true });
};
