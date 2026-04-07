import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/admin-auth';
import { getBackgroundJobById } from '$lib/server/background-jobs';

/**
 * GET /api/admin/jobs/:id
 * Fetch a single background job by id (admin only).
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	try {
		await requireAdmin(locals.userId);
		const job = await getBackgroundJobById(params.id);
		if (!job) {
			return json({ success: false, error: 'Job not found' }, { status: 404 });
		}

		return json({ success: true, job });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ success: false, error: message }, { status: 500 });
	}
};
