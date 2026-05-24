import { json } from '@sveltejs/kit';
import { updateTask, deleteTask, type TaskPatch } from '$lib/server/tasks';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const itemId = params.id;
	if (!itemId) return json({ error: 'id mangler' }, { status: 400 });

	const body = (await request.json()) as Partial<TaskPatch>;
	const patch: TaskPatch = {};
	if (typeof body.text === 'string') patch.text = body.text;
	if (body.estimateMinutes === null || typeof body.estimateMinutes === 'number') {
		patch.estimateMinutes = body.estimateMinutes;
	}
	if (body.dueDate === null || typeof body.dueDate === 'string') {
		patch.dueDate = body.dueDate;
	}
	if (body.themeId === null || typeof body.themeId === 'string') {
		patch.themeId = body.themeId;
	}
	if (typeof body.checked === 'boolean') patch.checked = body.checked;

	const ok = await updateTask(locals.userId, itemId, patch);
	if (!ok) return json({ error: 'Fant ikke item' }, { status: 404 });
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const itemId = params.id;
	if (!itemId) return json({ error: 'id mangler' }, { status: 400 });

	const ok = await deleteTask(locals.userId, itemId);
	if (!ok) return json({ error: 'Fant ikke item' }, { status: 404 });
	return json({ ok: true });
};
