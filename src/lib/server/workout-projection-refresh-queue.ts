import { db } from '$lib/db';
import { backgroundJobs } from '$lib/db/schema';
import { and, eq, gte } from 'drizzle-orm';

export const WORKOUT_PROJECTION_JOB_TYPE = 'workout_projection_refresh';
export const PROJECTION_CLUSTER_WINDOW_MS = 2 * 60 * 60 * 1000;
export const PROJECTION_ENQUEUE_DEBOUNCE_MS = 60 * 1000;

export type EnqueueWorkoutProjectionRefreshInput = {
	userId: string;
	fromDate: Date;
	toDate: Date;
	reason: 'on_write' | 'on_write_merge' | 'soft_stale' | 'hard_stale' | 'missing' | 'cron_sweeper' | 'manual';
	priority?: number;
	maxAttempts?: number;
	debounceMs?: number;
};

export function projectionWindowFromWorkoutTimestamp(eventTimestamp: Date): { fromDate: Date; toDate: Date } {
	const toDate = new Date();
	const fromDate = new Date(eventTimestamp.getTime() - PROJECTION_CLUSTER_WINDOW_MS);
	return { fromDate, toDate };
}

export async function enqueueWorkoutProjectionRefresh(
	input: EnqueueWorkoutProjectionRefreshInput
): Promise<{ enqueued: boolean; merged: boolean }> {
	const now = new Date();
	const debounceMs = input.debounceMs ?? PROJECTION_ENQUEUE_DEBOUNCE_MS;

	const existing = await db.query.backgroundJobs.findFirst({
		where: and(
			eq(backgroundJobs.userId, input.userId),
			eq(backgroundJobs.type, WORKOUT_PROJECTION_JOB_TYPE),
			eq(backgroundJobs.status, 'queued'),
			gte(backgroundJobs.createdAt, new Date(now.getTime() - debounceMs))
		),
		orderBy: (jobs, { desc: orderDesc }) => [orderDesc(jobs.createdAt)]
	});

	if (existing) {
		const payload = (existing.payload ?? {}) as Record<string, unknown>;
		const existingFrom = typeof payload.fromIso === 'string' ? new Date(payload.fromIso) : input.fromDate;
		const existingTo = typeof payload.toIso === 'string' ? new Date(payload.toIso) : input.toDate;
		const mergedFrom = existingFrom.getTime() < input.fromDate.getTime() ? existingFrom : input.fromDate;
		const mergedTo = existingTo.getTime() > input.toDate.getTime() ? existingTo : input.toDate;

		await db
			.update(backgroundJobs)
			.set({
				payload: {
					...payload,
					fromIso: mergedFrom.toISOString(),
					toIso: mergedTo.toISOString(),
					reason: input.reason === 'on_write' ? 'on_write_merge' : input.reason
				},
				updatedAt: new Date()
			})
			.where(eq(backgroundJobs.id, existing.id));

		return { enqueued: true, merged: true };
	}

	await db.insert(backgroundJobs).values({
		userId: input.userId,
		type: WORKOUT_PROJECTION_JOB_TYPE,
		status: 'queued',
		payload: {
			fromIso: input.fromDate.toISOString(),
			toIso: input.toDate.toISOString(),
			reason: input.reason
		},
		runAt: new Date(),
		priority: input.priority ?? 5,
		maxAttempts: input.maxAttempts ?? 3
	});

	return { enqueued: true, merged: false };
}
