import { json, type RequestHandler } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { ensureUser } from '$lib/server/users';
import { db } from '$lib/db';
import { tasks } from '$lib/db/schema';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	await ensureUser(locals.userId);
	const userId = locals.userId;
	const taskId = params.id;
	if (!taskId) return json({ error: 'taskId mangler' }, { status: 400 });

	const body = (await request.json().catch(() => ({}))) as { days?: unknown };
	const days = typeof body.days === 'number' && Number.isFinite(body.days) ? Math.max(1, Math.round(body.days)) : 1;

	const existing = await db.query.tasks.findFirst({
		where: and(eq(tasks.id, taskId), eq(tasks.userId, userId))
	});
	if (!existing) return json({ error: 'Fant ikke oppgaven' }, { status: 404 });

	const updates: Record<string, unknown> = { lastSurfacedAt: new Date(), updatedAt: new Date() };
	const target = new Date();
	target.setUTCDate(target.getUTCDate() + days);
	const iso = target.toISOString().slice(0, 10);
	updates.availableFrom = iso;

	await db.update(tasks).set(updates).where(eq(tasks.id, taskId));
	return json({ success: true, availableFrom: iso });
};
