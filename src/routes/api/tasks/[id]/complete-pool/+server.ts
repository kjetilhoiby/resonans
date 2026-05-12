import { json, type RequestHandler } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { ensureUser } from '$lib/server/users';
import { db } from '$lib/db';
import { tasks } from '$lib/db/schema';

export const POST: RequestHandler = async ({ locals, params }) => {
	await ensureUser(locals.userId);
	const userId = locals.userId;
	const taskId = params.id;
	if (!taskId) return json({ error: 'taskId mangler' }, { status: 400 });

	const [row] = await db
		.update(tasks)
		.set({ status: 'done', updatedAt: new Date() })
		.where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
		.returning({ id: tasks.id });
	if (!row) return json({ error: 'Fant ikke oppgaven' }, { status: 404 });
	return json({ success: true });
};
