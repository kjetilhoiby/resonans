import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { processDueBackgroundJobs } from '$lib/server/background-jobs';

export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => ({}));
	const requested = Number(body?.limit);
	const limit = Number.isFinite(requested) && requested > 0 ? Math.min(50, Math.floor(requested)) : 50;

	const result = await processDueBackgroundJobs({
		limit,
		workerId: `user-trigger-${locals.userId}-${Date.now()}`
	});

	return json({ success: true, ...result });
};
