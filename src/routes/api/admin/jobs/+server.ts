import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/admin-auth';
import { listRecentBackgroundJobs } from '$lib/server/background-jobs';

/**
 * GET /api/admin/jobs
 * Lists recent background jobs (admin only).
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		await requireAdmin(locals.userId);
		const limit = Number(url.searchParams.get('limit') ?? 50);
		const jobs = await listRecentBackgroundJobs(Number.isFinite(limit) ? limit : 50);
		return json({ success: true, jobs });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ success: false, error: message }, { status: 500 });
	}
};
