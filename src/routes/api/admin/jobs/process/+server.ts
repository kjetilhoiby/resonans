import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/admin-auth';
import { processDueBackgroundJobs } from '$lib/server/background-jobs';

/**
 * POST /api/admin/jobs/process
 * Manually process due background jobs (admin-only fallback).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		await requireAdmin(locals.userId);
		const body = await request.json().catch(() => ({}));
		const limitRaw = Number(body?.limit ?? 5);
		const limit = Number.isFinite(limitRaw) ? limitRaw : 5;

		const result = await processDueBackgroundJobs({
			limit,
			workerId: `admin-${locals.userId}-${Date.now()}`
		});

		return json({ success: true, ...result });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ success: false, error: message }, { status: 500 });
	}
};
