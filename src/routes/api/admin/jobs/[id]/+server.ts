import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/admin-auth';
import { getBackgroundJobById, cancelBackgroundJob, retryBackgroundJob, deleteBackgroundJob, processDueBackgroundJobs } from '$lib/server/background-jobs';

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

/**
 * PATCH /api/admin/jobs/:id  { action: 'retry' | 'cancel' }
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	try {
		await requireAdmin(locals.userId);
		const body = await request.json().catch(() => ({}));
		const action = body?.action;

		if (action === 'retry') {
			const job = await retryBackgroundJob(params.id);
			if (!job) return json({ success: false, error: 'Job not found' }, { status: 404 });
			// Kick off processing immediately
			void processDueBackgroundJobs({ limit: 1, workerId: `admin-retry-${params.id}` });
			return json({ success: true, job });
		}

		if (action === 'cancel') {
			const job = await cancelBackgroundJob(params.id);
			if (!job) return json({ success: false, error: 'Job not found' }, { status: 404 });
			return json({ success: true, job });
		}

		return json({ success: false, error: 'action must be "retry" or "cancel"' }, { status: 400 });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ success: false, error: message }, { status: 500 });
	}
};

/**
 * DELETE /api/admin/jobs/:id
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	try {
		await requireAdmin(locals.userId);
		const job = await deleteBackgroundJob(params.id);
		if (!job) return json({ success: false, error: 'Job not found' }, { status: 404 });
		return json({ success: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ success: false, error: message }, { status: 500 });
	}
};

