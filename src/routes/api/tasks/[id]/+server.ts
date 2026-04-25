import { json, type RequestHandler } from '@sveltejs/kit';
import { ensureUser } from '$lib/server/users';
import { db } from '$lib/db';
import { tasks, goals } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { setTaskSchedule, getProjectTree } from '$lib/server/goals';

async function ensureTaskOwner(taskId: string, userId: string) {
	const row = await db
		.select({ id: tasks.id })
		.from(tasks)
		.innerJoin(goals, eq(goals.id, tasks.goalId))
		.where(and(eq(tasks.id, taskId), eq(goals.userId, userId)))
		.limit(1);
	return !!row[0];
}

export const GET: RequestHandler = async ({ params, locals }) => {
	await ensureUser(locals.userId);
	const tree = await getProjectTree(params.id!, locals.userId);
	if (!tree) return json({ error: 'Not found' }, { status: 404 });
	return json(tree);
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	await ensureUser(locals.userId);
	const userId = locals.userId;
	const taskId = params.id!;

	if (!(await ensureTaskOwner(taskId, userId))) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

	const scheduleUpdate: Parameters<typeof setTaskSchedule>[2] = {};
	if ('startDate' in body) {
		scheduleUpdate.startDate = body.startDate ? new Date(body.startDate as string) : null;
	}
	if ('dueDate' in body) {
		scheduleUpdate.dueDate = body.dueDate ? new Date(body.dueDate as string) : null;
	}
	if ('sortOrder' in body) {
		scheduleUpdate.sortOrder = typeof body.sortOrder === 'number' ? body.sortOrder : null;
	}

	const directPatch: Record<string, unknown> = { updatedAt: new Date() };
	if (typeof body.title === 'string') directPatch.title = body.title.trim();
	if (typeof body.description === 'string') directPatch.description = body.description;
	if (typeof body.status === 'string') directPatch.status = body.status;

	try {
		if (Object.keys(scheduleUpdate).length > 0) {
			await setTaskSchedule(taskId, userId, scheduleUpdate);
		}
		if (Object.keys(directPatch).length > 1) {
			await db.update(tasks).set(directPatch).where(eq(tasks.id, taskId));
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 400 });
	}

	const updated = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
	return json({ task: updated });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	await ensureUser(locals.userId);
	const userId = locals.userId;
	const taskId = params.id!;

	if (!(await ensureTaskOwner(taskId, userId))) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	await db.delete(tasks).where(eq(tasks.id, taskId));
	return json({ ok: true });
};
