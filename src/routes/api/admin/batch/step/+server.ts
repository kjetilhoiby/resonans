import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-auth';
import { stepBatchJob } from '$lib/server/batch-runner';
import '$lib/server/batch-handlers';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	await requireAdmin(locals.userId);

	const body = await request.json().catch(() => null);
	if (!body?.jobId) {
		return json({ error: 'Påkrevd: jobId' }, { status: 400 });
	}

	const progress = await stepBatchJob(body.jobId);
	return json(progress);
};
