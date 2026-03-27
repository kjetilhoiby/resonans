import { db } from '$lib/db';
import { tasks, progress } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { json, error } from '@sveltejs/kit';
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

	if (!task || task.goal.userId !== userId) {
		throw error(404, 'Oppgave ikke funnet');
	}

	const body = await request.json().catch(() => ({}));
	const value = typeof body?.value === 'number' ? body.value : null;
	const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : null;

	const [record] = await db
		.insert(progress)
		.values({
			taskId: id,
			userId,
			value,
			note,
			completedAt: new Date()
		})
		.returning();

	return json({ id: record.id, completedAt: record.completedAt }, { status: 201 });
};
