import { json, type RequestHandler } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { ensureUser } from '$lib/server/users';
import { db } from '$lib/db';
import { tasks } from '$lib/db/schema';

const WEEK_KEY_RE = /^\d{4}-W\d{2}$/;

export const POST: RequestHandler = async ({ locals, params, request }) => {
	await ensureUser(locals.userId);
	const userId = locals.userId;
	const taskId = params.id;
	if (!taskId) return json({ error: 'taskId mangler' }, { status: 400 });

	const body = (await request.json().catch(() => ({}))) as { periodId?: unknown };
	const periodId = typeof body.periodId === 'string' ? body.periodId.trim() : '';
	if (!WEEK_KEY_RE.test(periodId)) {
		return json({ error: 'periodId må være på formatet YYYY-Www' }, { status: 400 });
	}

	const existing = await db.query.tasks.findFirst({
		where: and(eq(tasks.id, taskId), eq(tasks.userId, userId))
	});
	if (!existing) return json({ error: 'Fant ikke oppgaven' }, { status: 404 });

	const metadata = { ...(existing.metadata as Record<string, unknown> | null ?? {}), promotedFromPool: true };

	await db
		.update(tasks)
		.set({
			isPool: false,
			periodType: 'week',
			periodId,
			metadata,
			updatedAt: new Date()
		})
		.where(eq(tasks.id, taskId));

	return json({ success: true });
};
