import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { backgroundJobs } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { processDueBackgroundJobs } from '$lib/server/background-jobs';

// Only allow operating on jobs owned by the current user
async function getOwnedJob(jobId: string, userId: string) {
	const [job] = await db
		.select()
		.from(backgroundJobs)
		.where(and(eq(backgroundJobs.id, jobId), eq(backgroundJobs.userId, userId)))
		.limit(1);
	return job ?? null;
}

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json().catch(() => ({}));
	const action = body?.action;

	if (action === 'retry') {
		const exists = await getOwnedJob(params.id, locals.userId);
		if (!exists) return json({ success: false, error: 'Not found' }, { status: 404 });

		const [job] = await db
			.update(backgroundJobs)
			.set({ status: 'queued', attempts: 0, error: null, runAt: new Date(), updatedAt: new Date(), lockedAt: null, lockedBy: null })
			.where(and(eq(backgroundJobs.id, params.id), eq(backgroundJobs.userId, locals.userId)))
			.returning({ id: backgroundJobs.id, status: backgroundJobs.status });

		void processDueBackgroundJobs({ limit: 1, workerId: `user-retry-${params.id}` });
		return json({ success: true, job });
	}

	if (action === 'cancel') {
		const [job] = await db
			.update(backgroundJobs)
			.set({ status: 'canceled', updatedAt: new Date() })
			.where(and(eq(backgroundJobs.id, params.id), eq(backgroundJobs.userId, locals.userId)))
			.returning({ id: backgroundJobs.id, status: backgroundJobs.status });
		if (!job) return json({ success: false, error: 'Not found' }, { status: 404 });
		return json({ success: true, job });
	}

	return json({ success: false, error: 'action must be "retry" or "cancel"' }, { status: 400 });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const [job] = await db
		.delete(backgroundJobs)
		.where(and(eq(backgroundJobs.id, params.id), eq(backgroundJobs.userId, locals.userId)))
		.returning({ id: backgroundJobs.id });
	if (!job) return json({ success: false, error: 'Not found' }, { status: 404 });
	return json({ success: true });
};
