import { db, pgClient } from '$lib/db';
import { backgroundJobs } from '$lib/db/schema';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { syncAllSparebank1Data } from '$lib/server/integrations/sparebank1-sync';
import { processGoalIntentParseJob } from '$lib/server/goal-intent-parser';
import { processTaskIntentParseJob } from '$lib/server/task-intent-parser';
import { processBookContextCollectJob } from '$lib/server/book-context-collector';
import { autocheckChecklistItemsForDay } from '$lib/server/checklist-autocheck';
import { syncSensorProgressForTasks } from '$lib/server/sensor-progress-sync';
import { WorkoutProjectionService } from '$lib/server/services/workout-projection-service';

export type BackgroundJobStatus = 'queued' | 'running' | 'retry' | 'completed' | 'failed' | 'canceled';

export type EnqueueBackgroundJobInput = {
	userId?: string | null;
	type: string;
	payload?: Record<string, unknown>;
	runAt?: Date;
	priority?: number;
	maxAttempts?: number;
};

export async function enqueueBackgroundJob(input: EnqueueBackgroundJobInput) {
	const [job] = await db
		.insert(backgroundJobs)
		.values({
			userId: input.userId ?? null,
			type: input.type,
			status: 'queued',
			payload: input.payload ?? {},
			runAt: input.runAt ?? new Date(),
			priority: input.priority ?? 0,
			maxAttempts: input.maxAttempts ?? 3
		})
		.returning({
			id: backgroundJobs.id,
			type: backgroundJobs.type,
			status: backgroundJobs.status,
			runAt: backgroundJobs.runAt,
			createdAt: backgroundJobs.createdAt
		});

	return job;
}

export async function getBackgroundJobById(jobId: string) {
	const [job] = await db
		.select()
		.from(backgroundJobs)
		.where(eq(backgroundJobs.id, jobId))
		.limit(1);

	return job ?? null;
}

export async function cancelBackgroundJob(jobId: string) {
	const [job] = await db
		.update(backgroundJobs)
		.set({ status: 'canceled', updatedAt: new Date() })
		.where(and(eq(backgroundJobs.id, jobId)))
		.returning({ id: backgroundJobs.id, status: backgroundJobs.status });
	return job ?? null;
}

export async function retryBackgroundJob(jobId: string) {
	const [job] = await db
		.update(backgroundJobs)
		.set({ status: 'queued', attempts: 0, error: null, runAt: new Date(), updatedAt: new Date(), lockedAt: null, lockedBy: null })
		.where(eq(backgroundJobs.id, jobId))
		.returning({ id: backgroundJobs.id, status: backgroundJobs.status });
	return job ?? null;
}

export async function deleteBackgroundJob(jobId: string) {
	const [job] = await db
		.delete(backgroundJobs)
		.where(eq(backgroundJobs.id, jobId))
		.returning({ id: backgroundJobs.id });
	return job ?? null;
}

export async function listRecentBackgroundJobs(limit = 50) {
	const jobs = await db
		.select({
			id: backgroundJobs.id,
			userId: backgroundJobs.userId,
			type: backgroundJobs.type,
			status: backgroundJobs.status,
			attempts: backgroundJobs.attempts,
			maxAttempts: backgroundJobs.maxAttempts,
			runAt: backgroundJobs.runAt,
			createdAt: backgroundJobs.createdAt,
			updatedAt: backgroundJobs.updatedAt,
			startedAt: backgroundJobs.startedAt,
			finishedAt: backgroundJobs.finishedAt,
			error: backgroundJobs.error,
			result: backgroundJobs.result
		})
		.from(backgroundJobs)
		.orderBy(desc(backgroundJobs.createdAt))
		.limit(Math.max(1, Math.min(limit, 200)));

	return jobs.map((job) => {
		const result = (job.result ?? {}) as Record<string, unknown>;
		let resultSummary: Record<string, unknown> | null = null;

		if (job.type === 'sync_sensor_to_task_progress') {
			resultSummary = {
				created: result.created ?? 0,
				skipped: result.skipped ?? 0,
				skippedByPeriod: result.skippedByPeriod ?? 0,
				skippedDuplicate: result.skippedDuplicate ?? 0
			};
		}

		if (job.type === 'checklist_autocheck') {
			const summary = (result.summary ?? {}) as Record<string, unknown>;
			resultSummary = {
				total: summary.total ?? 0,
				autoChecked: summary.autoChecked ?? 0,
				progressCreated: summary.progressCreated ?? 0,
				progressSkippedByPeriod: summary.progressSkippedByPeriod ?? 0,
				progressSkippedDuplicate: summary.progressSkippedDuplicate ?? 0
			};
		}

		return {
			...job,
			resultSummary
		};
	});
}

export async function listRecentGoalIntentParseJobsForUser(userId: string, limit = 20) {
	const safeLimit = Math.max(1, Math.min(limit, 100));

	const jobs = await db
		.select({
			id: backgroundJobs.id,
			status: backgroundJobs.status,
			attempts: backgroundJobs.attempts,
			maxAttempts: backgroundJobs.maxAttempts,
			error: backgroundJobs.error,
			payload: backgroundJobs.payload,
			result: backgroundJobs.result,
			createdAt: backgroundJobs.createdAt,
			updatedAt: backgroundJobs.updatedAt,
			finishedAt: backgroundJobs.finishedAt
		})
		.from(backgroundJobs)
		.where(and(eq(backgroundJobs.userId, userId), eq(backgroundJobs.type, 'goal_intent_parse')))
		.orderBy(desc(backgroundJobs.createdAt))
		.limit(safeLimit);

	return jobs.map((job) => {
		const payload = (job.payload ?? {}) as Record<string, unknown>;
		const result = (job.result ?? {}) as Record<string, unknown>;
		const parsed = (result.parsed ?? {}) as Record<string, unknown>;

		return {
			id: job.id,
			status: job.status,
			attempts: job.attempts,
			maxAttempts: job.maxAttempts,
			error: job.error,
			goalId: typeof payload.goalId === 'string' ? payload.goalId : null,
			rawText: typeof payload.rawText === 'string' ? payload.rawText : null,
			matched: typeof parsed.matched === 'boolean' ? parsed.matched : null,
			reason: typeof parsed.reason === 'string' ? parsed.reason : null,
			parsedIntent: (parsed.parsedIntent ?? null) as Record<string, unknown> | null,
			createdAt: job.createdAt,
			updatedAt: job.updatedAt,
			finishedAt: job.finishedAt
		};
	});
}

export async function listRecentTaskIntentParseJobsForUser(userId: string, limit = 20) {
	const safeLimit = Math.max(1, Math.min(limit, 100));

	const jobs = await db
		.select({
			id: backgroundJobs.id,
			status: backgroundJobs.status,
			attempts: backgroundJobs.attempts,
			maxAttempts: backgroundJobs.maxAttempts,
			error: backgroundJobs.error,
			payload: backgroundJobs.payload,
			result: backgroundJobs.result,
			createdAt: backgroundJobs.createdAt,
			updatedAt: backgroundJobs.updatedAt,
			finishedAt: backgroundJobs.finishedAt
		})
		.from(backgroundJobs)
		.where(and(eq(backgroundJobs.userId, userId), eq(backgroundJobs.type, 'task_intent_parse')))
		.orderBy(desc(backgroundJobs.createdAt))
		.limit(safeLimit);

	return jobs.map((job) => {
		const payload = (job.payload ?? {}) as Record<string, unknown>;
		const result = (job.result ?? {}) as Record<string, unknown>;
		const parsed = (result.parsed ?? {}) as Record<string, unknown>;

		return {
			id: job.id,
			status: job.status,
			attempts: job.attempts,
			maxAttempts: job.maxAttempts,
			error: job.error,
			taskId: typeof payload.taskId === 'string' ? payload.taskId : null,
			rawText: typeof payload.rawText === 'string' ? payload.rawText : null,
			matched: typeof parsed.matched === 'boolean' ? parsed.matched : null,
			reason: typeof parsed.reason === 'string' ? parsed.reason : null,
			parsedIntent: (parsed.parsedIntent ?? null) as Record<string, unknown> | null,
			createdAt: job.createdAt,
			updatedAt: job.updatedAt,
			finishedAt: job.finishedAt
		};
	});
}

export async function getGoalIntentParseObservability(hours = 24 * 7) {
	return getIntentParseObservability('goal_intent_parse', hours);
}

export async function getTaskIntentParseObservability(hours = 24 * 7) {
	return getIntentParseObservability('task_intent_parse', hours);
}

export async function enqueueStaleWorkoutProjectionRefreshSweep(opts?: { maxAgeMs?: number; limit?: number }) {
	const maxAgeMs = Math.max(60 * 1000, opts?.maxAgeMs ?? 15 * 60 * 1000);
	const limit = Math.max(1, Math.min(opts?.limit ?? 100, 1000));

	const result = await WorkoutProjectionService.enqueueRefreshForStaleUsers(maxAgeMs, limit);

	console.log(
		`[background-jobs] workout sweeper scanned=${result.scanned} stale=${result.staleUsers.length} enqueued=${result.enqueued} maxAgeMs=${maxAgeMs}`
	);

	return {
		maxAgeMs,
		...result
	};
}

async function getIntentParseObservability(jobType: 'goal_intent_parse' | 'task_intent_parse', hours = 24 * 7) {
	const safeHours = Math.max(1, Math.min(hours, 24 * 90));

	const summaryRows = await pgClient.unsafe<{
		total: number;
		queued: number;
		running: number;
		retry: number;
		completed: number;
		failed: number;
		matched: number;
		unmatched: number;
	}[]>(`
		SELECT
			COUNT(*)::int AS total,
			COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
			COUNT(*) FILTER (WHERE status = 'running')::int AS running,
			COUNT(*) FILTER (WHERE status = 'retry')::int AS retry,
			COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
			COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
			COUNT(*) FILTER (
				WHERE status = 'completed'
				  AND COALESCE((result->'parsed'->>'matched')::boolean, false) = true
			)::int AS matched,
			COUNT(*) FILTER (
				WHERE status = 'completed'
				  AND COALESCE((result->'parsed'->>'matched')::boolean, false) = false
			)::int AS unmatched
		FROM background_jobs
		WHERE type = $2
		  AND created_at >= NOW() - ($1::int * INTERVAL '1 hour')
	`, [safeHours, jobType]);

	const reasonsRows = await pgClient.unsafe<{
		reason: string;
		count: number;
	}[]>(`
		SELECT
			COALESCE(result->'parsed'->>'reason', 'unknown') AS reason,
			COUNT(*)::int AS count
		FROM background_jobs
		WHERE type = $2
		  AND status = 'completed'
		  AND COALESCE((result->'parsed'->>'matched')::boolean, false) = false
		  AND created_at >= NOW() - ($1::int * INTERVAL '1 hour')
		GROUP BY 1
		ORDER BY count DESC
		LIMIT 5
	`, [safeHours, jobType]);

	const errorRows = await pgClient.unsafe<{
		error: string;
		count: number;
	}[]>(`
		SELECT
			COALESCE(NULLIF(error, ''), 'unknown') AS error,
			COUNT(*)::int AS count
		FROM background_jobs
		WHERE type = $2
		  AND status = 'failed'
		  AND created_at >= NOW() - ($1::int * INTERVAL '1 hour')
		GROUP BY 1
		ORDER BY count DESC
		LIMIT 5
	`, [safeHours, jobType]);

	const summary = summaryRows[0] ?? {
		total: 0,
		queued: 0,
		running: 0,
		retry: 0,
		completed: 0,
		failed: 0,
		matched: 0,
		unmatched: 0
	};

	return {
		jobType,
		hours: safeHours,
		total: Number(summary.total ?? 0),
		status: {
			queued: Number(summary.queued ?? 0),
			running: Number(summary.running ?? 0),
			retry: Number(summary.retry ?? 0),
			completed: Number(summary.completed ?? 0),
			failed: Number(summary.failed ?? 0)
		},
		outcomes: {
			matched: Number(summary.matched ?? 0),
			unmatched: Number(summary.unmatched ?? 0)
		},
		topUnmatchedReasons: reasonsRows.map((row) => ({
			reason: row.reason,
			count: Number(row.count ?? 0)
		})),
		topFailureErrors: errorRows.map((row) => ({
			error: row.error,
			count: Number(row.count ?? 0)
		}))
	};
}

function calculateRetryDelaySeconds(attempt: number): number {
	// Exponential backoff: 60s, 120s, 240s, ... capped at 1 hour.
	return Math.min(3600, Math.pow(2, Math.max(0, attempt - 1)) * 60);
}

async function claimNextDueJob(workerId: string) {
	const rows = await pgClient.unsafe<{
		id: string;
		user_id: string | null;
		type: string;
		payload: Record<string, unknown> | null;
		attempts: number;
		max_attempts: number;
		run_at: Date;
	}[]>(`
		WITH next_job AS (
			SELECT id
			FROM background_jobs
			WHERE status IN ('queued', 'retry')
			  AND run_at <= NOW()
			ORDER BY priority DESC, run_at ASC, created_at ASC
			LIMIT 1
			FOR UPDATE SKIP LOCKED
		)
		UPDATE background_jobs AS bj
		SET
			status = 'running',
			attempts = bj.attempts + 1,
			locked_at = NOW(),
			locked_by = $1,
			started_at = COALESCE(bj.started_at, NOW()),
			updated_at = NOW(),
			error = NULL
		FROM next_job
		WHERE bj.id = next_job.id
		RETURNING bj.*
	`, [workerId]);

	return (rows[0] ?? null);
}

async function executeJob(job: any): Promise<Record<string, unknown>> {
	switch (job.type) {
		case 'sparebank1_historical_sync': {
			if (!job.user_id) {
				throw new Error('sparebank1_historical_sync requires user_id');
			}

			const payload = (job.payload ?? {}) as { fromDate?: string };
			const fromDate = payload.fromDate ? new Date(payload.fromDate) : new Date('2025-01-01');
			if (Number.isNaN(fromDate.getTime())) {
				throw new Error(`Invalid fromDate in payload: ${String(payload.fromDate)}`);
			}

			const synced = await syncAllSparebank1Data(job.user_id, { fromDate });
			return {
				fromDate: fromDate.toISOString().slice(0, 10),
				synced
			};
		}
		case 'goal_intent_parse': {
			if (!job.user_id) {
				throw new Error('goal_intent_parse requires user_id');
			}

			const payload = (job.payload ?? {}) as { goalId?: string; rawText?: string };
			if (!payload.goalId || typeof payload.goalId !== 'string') {
				throw new Error('goal_intent_parse requires payload.goalId');
			}

			const parsed = await processGoalIntentParseJob({
				userId: job.user_id,
				goalId: payload.goalId,
				rawText: typeof payload.rawText === 'string' ? payload.rawText : undefined
			});

			return {
				goalId: payload.goalId,
				parsed
			};
		}
		case 'task_intent_parse': {
			if (!job.user_id) {
				throw new Error('task_intent_parse requires user_id');
			}

			const payload = (job.payload ?? {}) as { taskId?: string; rawText?: string };
			if (!payload.taskId || typeof payload.taskId !== 'string') {
				throw new Error('task_intent_parse requires payload.taskId');
			}

			const parsed = await processTaskIntentParseJob({
				userId: job.user_id,
				taskId: payload.taskId,
				rawText: typeof payload.rawText === 'string' ? payload.rawText : undefined
			});

			return {
				taskId: payload.taskId,
				parsed
			};
		}
		case 'book_context_collect': {
			const payload = (job.payload ?? {}) as { bookId?: string; title?: string; author?: string | null };
			if (!payload.bookId || typeof payload.bookId !== 'string') {
				throw new Error('book_context_collect requires payload.bookId');
			}
			if (!payload.title || typeof payload.title !== 'string') {
				throw new Error('book_context_collect requires payload.title');
			}

			const contextPack = await processBookContextCollectJob({
				bookId: payload.bookId,
				title: payload.title,
				author: typeof payload.author === 'string' ? payload.author : null
			});

			return { bookId: payload.bookId, contextPack };
		}
		case 'checklist_autocheck': {
			if (!job.user_id) throw new Error('checklist_autocheck requires user_id');
			const payload = (job.payload ?? {}) as { date?: string };
			if (!payload.date || typeof payload.date !== 'string') {
				throw new Error('checklist_autocheck requires payload.date (ISO string)');
			}
			const results = await autocheckChecklistItemsForDay({ userId: job.user_id, date: payload.date });
			const summary = {
				total: results.length,
				autoChecked: results.filter((r) => r.autoChecked).length,
				progressCreated: results.filter((r) => r.progressStatus === 'created').length,
				progressSkippedByPeriod: results.filter((r) => r.progressStatus === 'period_target_reached').length,
				progressSkippedDuplicate: results.filter((r) => r.progressStatus === 'duplicate').length
			};
			return { date: payload.date, summary, results };
		}
		case 'sync_sensor_to_task_progress': {
			if (!job.user_id) throw new Error('sync_sensor_to_task_progress requires user_id');
			const payload = (job.payload ?? {}) as { weekStart?: string; weekEnd?: string };
			if (!payload.weekStart || !payload.weekEnd) {
				throw new Error('sync_sensor_to_task_progress requires payload.weekStart and weekEnd');
			}
			const result = await syncSensorProgressForTasks({
				userId: job.user_id,
				weekStart: new Date(payload.weekStart),
				weekEnd: new Date(payload.weekEnd)
			});
			return { weekStart: payload.weekStart, weekEnd: payload.weekEnd, ...result };
		}
		case 'workout_projection_refresh': {
			if (!job.user_id) throw new Error('workout_projection_refresh requires user_id');
			const payload = (job.payload ?? {}) as { fromIso?: string; toIso?: string; reason?: string };
			if (!payload.fromIso || !payload.toIso) {
				throw new Error('workout_projection_refresh requires payload.fromIso and payload.toIso');
			}
			const fromDate = new Date(payload.fromIso);
			const toDate = new Date(payload.toIso);
			if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
				throw new Error('workout_projection_refresh payload dates must be valid ISO strings');
			}
			const refreshed = await WorkoutProjectionService.refreshForRange(job.user_id, fromDate, toDate);
			return {
				fromIso: payload.fromIso,
				toIso: payload.toIso,
				reason: payload.reason ?? 'unknown',
				...refreshed
			};
		}
		default:
			throw new Error(`Unknown background job type: ${job.type}`);
	}
}

export async function processDueBackgroundJobs(opts?: { limit?: number; workerId?: string }) {
	const limit = Math.max(1, Math.min(opts?.limit ?? 5, 50));
	const workerId = opts?.workerId ?? `worker-${Date.now()}`;

	let processed = 0;
	let completed = 0;
	let failed = 0;
	let retried = 0;
	const automation = {
		sensorProgress: {
			created: 0,
			skipped: 0,
			skippedByPeriod: 0,
			skippedDuplicate: 0
		},
		checklistAutocheck: {
			total: 0,
			autoChecked: 0,
			progressCreated: 0,
			progressSkippedByPeriod: 0,
			progressSkippedDuplicate: 0
		}
	};

	for (let i = 0; i < limit; i++) {
		const job = await claimNextDueJob(workerId);
		if (!job) break;

		processed += 1;

		try {
			const result = await executeJob(job);

			if (job.type === 'sync_sensor_to_task_progress') {
				const typedResult = result as {
					created?: number;
					skipped?: number;
					skippedByPeriod?: number;
					skippedDuplicate?: number;
				};
				automation.sensorProgress.created += typedResult.created ?? 0;
				automation.sensorProgress.skipped += typedResult.skipped ?? 0;
				automation.sensorProgress.skippedByPeriod += typedResult.skippedByPeriod ?? 0;
				automation.sensorProgress.skippedDuplicate += typedResult.skippedDuplicate ?? 0;
			}

			if (job.type === 'checklist_autocheck') {
				const typedResult = result as {
					summary?: {
						total?: number;
						autoChecked?: number;
						progressCreated?: number;
						progressSkippedByPeriod?: number;
						progressSkippedDuplicate?: number;
					};
				};
				automation.checklistAutocheck.total += typedResult.summary?.total ?? 0;
				automation.checklistAutocheck.autoChecked += typedResult.summary?.autoChecked ?? 0;
				automation.checklistAutocheck.progressCreated += typedResult.summary?.progressCreated ?? 0;
				automation.checklistAutocheck.progressSkippedByPeriod += typedResult.summary?.progressSkippedByPeriod ?? 0;
				automation.checklistAutocheck.progressSkippedDuplicate += typedResult.summary?.progressSkippedDuplicate ?? 0;
			}

			await db
				.update(backgroundJobs)
				.set({
					status: 'completed',
					result,
					finishedAt: new Date(),
					lockedAt: null,
					lockedBy: null,
					updatedAt: new Date(),
					error: null
				})
				.where(eq(backgroundJobs.id, String(job.id)));

			completed += 1;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const attempts = Number(job.attempts ?? 1);
			const maxAttempts = Number(job.max_attempts ?? 3);
			const shouldRetry = attempts < maxAttempts;
			const nextRunAt = new Date(Date.now() + calculateRetryDelaySeconds(attempts) * 1000);

			await db
				.update(backgroundJobs)
				.set({
					status: shouldRetry ? 'retry' : 'failed',
					error: message,
					runAt: shouldRetry ? nextRunAt : new Date(job.run_at),
					finishedAt: shouldRetry ? null : new Date(),
					lockedAt: null,
					lockedBy: null,
					updatedAt: new Date()
				})
				.where(eq(backgroundJobs.id, String(job.id)));

			if (shouldRetry) {
				retried += 1;
			} else {
				failed += 1;
			}
		}
	}

	const queueStatsRows = await db
		.select({
			queued: sql<number>`COUNT(*) FILTER (WHERE ${backgroundJobs.status} IN ('queued','retry'))`,
			running: sql<number>`COUNT(*) FILTER (WHERE ${backgroundJobs.status} = 'running')`,
			failed: sql<number>`COUNT(*) FILTER (WHERE ${backgroundJobs.status} = 'failed')`
		})
		.from(backgroundJobs)
		.where(and(gte(backgroundJobs.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))));

	const queueStats = queueStatsRows[0] ?? { queued: 0, running: 0, failed: 0 };

	return {
		processed,
		completed,
		failed,
		retried,
		automation,
		queue: {
			queued: Number(queueStats.queued ?? 0),
			running: Number(queueStats.running ?? 0),
			failed: Number(queueStats.failed ?? 0)
		}
	};
}
