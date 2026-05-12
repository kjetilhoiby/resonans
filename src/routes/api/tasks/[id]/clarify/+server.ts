import { json, type RequestHandler } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { ensureUser } from '$lib/server/users';
import { db } from '$lib/db';
import { tasks } from '$lib/db/schema';
import { parseYearlyWindow } from '$lib/server/pool/yearly-window';

function parseIsoDate(v: unknown): string | null {
	if (typeof v !== 'string') return null;
	const trimmed = v.trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
	return trimmed;
}

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	await ensureUser(locals.userId);
	const userId = locals.userId;
	const taskId = params.id;
	if (!taskId) return json({ error: 'taskId mangler' }, { status: 400 });

	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

	const existing = await db.query.tasks.findFirst({
		where: and(eq(tasks.id, taskId), eq(tasks.userId, userId))
	});
	if (!existing) return json({ error: 'Fant ikke oppgaven' }, { status: 404 });

	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (typeof body.estimatedMinutes === 'number' && Number.isFinite(body.estimatedMinutes)) {
		updates.estimatedMinutes = Math.max(1, Math.round(body.estimatedMinutes));
	}
	if (body.effort === 'low' || body.effort === 'medium' || body.effort === 'high') {
		updates.effort = body.effort;
	}
	const dueDate = parseIsoDate(body.dueDate);
	if (dueDate) updates.dueDate = dueDate;

	if (typeof body.yearlyWindow === 'string' && body.yearlyWindow.trim()) {
		const trimmed = body.yearlyWindow.trim();
		if (!parseYearlyWindow(trimmed)) {
			return json({ error: 'ugyldig yearlyWindow' }, { status: 400 });
		}
		updates.yearlyWindow = trimmed;
		updates.recurrenceYearly = true;
	}

	if (typeof body.projectId === 'string') {
		updates.projectId = body.projectId || null;
	}

	if (Array.isArray(body.contextTags)) {
		updates.contextTags = (body.contextTags as unknown[]).filter(
			(v): v is string => typeof v === 'string' && v.length > 0
		);
	}

	if (Object.keys(updates).length === 1) {
		return json({ success: true, noop: true });
	}

	await db.update(tasks).set(updates).where(eq(tasks.id, taskId));
	return json({ success: true });
};
