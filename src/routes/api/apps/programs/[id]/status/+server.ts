import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setProgramStatus } from '$lib/server/programs/repository';
import { isProgramStatus, PROGRAM_STATUSES } from '$lib/server/programs/constants';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: { status?: unknown };
	try {
		body = (await request.json()) as { status?: unknown };
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	if (!isProgramStatus(body.status)) {
		throw error(400, `status må være en av: ${PROGRAM_STATUSES.join(', ')}`);
	}

	const ok = await setProgramStatus(userId, params.id, body.status);
	if (!ok) return json({ error: 'Program not found', code: 'program_not_found' }, { status: 404 });

	return json({ ok: true, status: body.status });
};
