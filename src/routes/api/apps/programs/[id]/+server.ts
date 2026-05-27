import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteProgram, getFullProgram } from '$lib/server/programs/repository';

export const GET: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const program = await getFullProgram(userId, params.id);
	if (!program) return json({ error: 'Program not found', code: 'program_not_found' }, { status: 404 });

	return json({ program });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const ok = await deleteProgram(userId, params.id);
	if (!ok) return json({ error: 'Program not found', code: 'program_not_found' }, { status: 404 });

	return json({ ok: true });
};
