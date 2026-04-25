import { json, type RequestHandler } from '@sveltejs/kit';
import { ensureUser } from '$lib/server/users';
import { listTaskFiles, uploadTaskFile } from '$lib/server/task-files';

export const GET: RequestHandler = async ({ params, locals }) => {
	await ensureUser(locals.userId);
	const files = await listTaskFiles(params.id!, locals.userId);
	if (files === null) return json({ error: 'Not found' }, { status: 404 });
	return json(files);
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	await ensureUser(locals.userId);
	const formData = await request.formData();
	const file = formData.get('file');
	if (!(file instanceof File)) return json({ error: 'No file provided' }, { status: 400 });

	const result = await uploadTaskFile(params.id!, locals.userId, file);

	switch (result.status) {
		case 'not_found':
			return json({ error: 'Not found' }, { status: 404 });
		case 'storage_unavailable':
			return json({ error: 'File storage not configured' }, { status: 500 });
		case 'too_large':
			return json({ error: 'File too large (max 20 MB)' }, { status: 413 });
		case 'ok':
			return json(result.file);
	}
};
