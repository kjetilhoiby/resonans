import { json, type RequestHandler } from '@sveltejs/kit';
import { ensureUser } from '$lib/server/users';
import { createSubtask } from '$lib/server/goals';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	await ensureUser(locals.userId);
	const userId = locals.userId;
	const parentTaskId = params.id!;

	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const title = typeof body.title === 'string' ? body.title.trim() : '';
	const description = typeof body.description === 'string' ? body.description.trim() : undefined;
	const sortOrder =
		typeof body.sortOrder === 'number' && Number.isFinite(body.sortOrder)
			? (body.sortOrder as number)
			: undefined;

	if (!title) return json({ error: 'title er påkrevd' }, { status: 400 });

	try {
		const task = await createSubtask({ parentTaskId, userId, title, description, sortOrder });
		return json({ task }, { status: 201 });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message === 'Parent task not found for user') {
			return json({ error: message }, { status: 404 });
		}
		if (message.startsWith('Cannot nest')) {
			return json({ error: message }, { status: 400 });
		}
		console.error('[subtasks POST] failed:', err);
		return json({ error: 'Kunne ikke opprette steg' }, { status: 500 });
	}
};
