import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-auth';
import { startBatchJob } from '$lib/server/batch-runner';
import '$lib/server/batch-handlers';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	await requireAdmin(locals.userId);

	const body = await request.json().catch(() => null);
	if (!body?.type || !body?.fromDate || !body?.toDate) {
		return json({ error: 'Påkrevd: type, fromDate, toDate' }, { status: 400 });
	}

	const jobId = await startBatchJob({
		userId: locals.userId,
		type: body.type,
		fromDate: body.fromDate,
		toDate: body.toDate,
		extraPayload: body.extra ?? {}
	});

	return json({ jobId });
};
