import { json, type RequestHandler } from '@sveltejs/kit';
import { ensureUser } from '$lib/server/users';
import { deleteTaskFile } from '$lib/server/task-files';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	await ensureUser(locals.userId);
	const ok = await deleteTaskFile(params.id!, locals.userId, params.fileId!);
	if (!ok) return json({ error: 'Not found' }, { status: 404 });
	return json({ ok: true });
};
