import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { backgroundJobs } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';

type BulkAction = 'delete_failed' | 'delete_completed' | 'cancel_queued' | 'requeue_failed';

const ACTIONS: BulkAction[] = ['delete_failed', 'delete_completed', 'cancel_queued', 'requeue_failed'];

export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => ({}));
	const action = body?.action as BulkAction | undefined;

	if (!action || !ACTIONS.includes(action)) {
		return json(
			{ success: false, error: `action must be one of ${ACTIONS.join(', ')}` },
			{ status: 400 }
		);
	}

	const userId = locals.userId;

	if (action === 'delete_failed') {
		const rows = await db
			.delete(backgroundJobs)
			.where(and(eq(backgroundJobs.userId, userId), eq(backgroundJobs.status, 'failed')))
			.returning({ id: backgroundJobs.id });
		return json({ success: true, affected: rows.length });
	}

	if (action === 'delete_completed') {
		const rows = await db
			.delete(backgroundJobs)
			.where(and(eq(backgroundJobs.userId, userId), eq(backgroundJobs.status, 'completed')))
			.returning({ id: backgroundJobs.id });
		return json({ success: true, affected: rows.length });
	}

	if (action === 'cancel_queued') {
		const rows = await db
			.update(backgroundJobs)
			.set({ status: 'canceled', updatedAt: new Date() })
			.where(
				and(
					eq(backgroundJobs.userId, userId),
					inArray(backgroundJobs.status, ['queued', 'retry'])
				)
			)
			.returning({ id: backgroundJobs.id });
		return json({ success: true, affected: rows.length });
	}

	if (action === 'requeue_failed') {
		const rows = await db
			.update(backgroundJobs)
			.set({
				status: 'queued',
				attempts: 0,
				error: null,
				runAt: new Date(),
				lockedAt: null,
				lockedBy: null,
				updatedAt: new Date()
			})
			.where(and(eq(backgroundJobs.userId, userId), eq(backgroundJobs.status, 'failed')))
			.returning({ id: backgroundJobs.id });
		return json({ success: true, affected: rows.length });
	}

	return json({ success: false, error: 'unreachable' }, { status: 500 });
};
