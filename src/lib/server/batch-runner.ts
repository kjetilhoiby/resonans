import { db } from '$lib/db';
import { backgroundJobs } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export interface BatchHandler<TStats extends Record<string, unknown> = Record<string, unknown>> {
	/** Process one calendar day. Throw to signal failure (job will be marked failed). */
	processDay(userId: string, date: string): Promise<TStats>;
	/** Merge per-day stats into accumulated stats. */
	mergeStats(accumulated: TStats, day: TStats): TStats;
	/** Initial/empty stats value. */
	initialStats(): TStats;
}

const registry = new Map<string, BatchHandler<any>>();

export function registerBatchHandler(type: string, handler: BatchHandler<any>) {
	registry.set(type, handler);
}

function dateRange(fromDate: string, toDate: string): string[] {
	const dates: string[] = [];
	const d = new Date(`${fromDate}T00:00:00Z`);
	const end = new Date(`${toDate}T00:00:00Z`);
	while (d <= end) {
		dates.push(d.toISOString().split('T')[0]);
		d.setUTCDate(d.getUTCDate() + 1);
	}
	return dates;
}

export type BatchProgress = {
	done: boolean;
	processedDays: number;
	totalDays: number;
	progressPct: number;
	nextDate: string | null;
	stats: Record<string, unknown>;
	error: string | null;
};

/**
 * Create a new batch job. Returns the jobId to pass to stepBatchJob.
 */
export async function startBatchJob(opts: {
	userId: string;
	type: string;
	fromDate: string;
	toDate: string;
	extraPayload?: Record<string, unknown>;
}): Promise<string> {
	const handler = registry.get(opts.type);
	if (!handler) throw new Error(`No batch handler registered for type: ${opts.type}`);

	const totalDays = dateRange(opts.fromDate, opts.toDate).length;

	const [job] = await db
		.insert(backgroundJobs)
		.values({
			userId: opts.userId,
			type: `batch:${opts.type}`,
			status: 'running',
			payload: {
				batchType: opts.type,
				fromDate: opts.fromDate,
				toDate: opts.toDate,
				...(opts.extraPayload ?? {})
			},
			result: {
				processedDays: 0,
				totalDays,
				nextDate: opts.fromDate,
				stats: handler.initialStats()
			},
			startedAt: new Date()
		})
		.returning({ id: backgroundJobs.id });

	return job.id;
}

/**
 * Process one day of an existing batch job. Call repeatedly from the UI until done === true.
 */
export async function stepBatchJob(jobId: string): Promise<BatchProgress> {
	const [job] = await db
		.select()
		.from(backgroundJobs)
		.where(eq(backgroundJobs.id, jobId))
		.limit(1);

	if (!job) throw new Error(`Batch job not found: ${jobId}`);

	const result = (job.result ?? {}) as {
		processedDays: number;
		totalDays: number;
		nextDate: string | null;
		stats: Record<string, unknown>;
	};

	// Already finished
	if (job.status === 'completed' || job.status === 'canceled') {
		return {
			done: true,
			processedDays: result.processedDays ?? 0,
			totalDays: result.totalDays ?? 0,
			progressPct: 100,
			nextDate: null,
			stats: result.stats ?? {},
			error: null
		};
	}
	if (job.status === 'failed') {
		return {
			done: true,
			processedDays: result.processedDays ?? 0,
			totalDays: result.totalDays ?? 0,
			progressPct: Math.round(((result.processedDays ?? 0) / (result.totalDays || 1)) * 100),
			nextDate: result.nextDate ?? null,
			stats: result.stats ?? {},
			error: job.error ?? 'Unknown error'
		};
	}

	const payload = job.payload as {
		batchType: string;
		fromDate: string;
		toDate: string;
	};

	const nextDate = result.nextDate ?? payload.fromDate;
	const totalDays = result.totalDays ?? 0;
	let processedDays = result.processedDays ?? 0;
	let accStats = result.stats ?? {};

	const handler = registry.get(payload.batchType);
	if (!handler) throw new Error(`No batch handler registered for type: ${payload.batchType}`);

	try {
		const dayStats = await handler.processDay(job.userId!, nextDate);
		accStats = handler.mergeStats(accStats as any, dayStats);
		processedDays++;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await db
			.update(backgroundJobs)
			.set({
				status: 'failed',
				error: message,
				finishedAt: new Date(),
				updatedAt: new Date(),
				result: { ...result, processedDays, nextDate, stats: accStats }
			})
			.where(eq(backgroundJobs.id, jobId));
		return {
			done: true,
			processedDays,
			totalDays,
			progressPct: Math.round((processedDays / (totalDays || 1)) * 100),
			nextDate,
			stats: accStats,
			error: message
		};
	}

	// Advance to next date
	const d = new Date(`${nextDate}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + 1);
	const afterDate = d.toISOString().split('T')[0];
	const done = nextDate >= payload.toDate;

	const newResult = {
		processedDays,
		totalDays,
		nextDate: done ? null : afterDate,
		stats: accStats
	};

	await db
		.update(backgroundJobs)
		.set({
			status: done ? 'completed' : 'running',
			result: newResult,
			finishedAt: done ? new Date() : null,
			updatedAt: new Date()
		})
		.where(eq(backgroundJobs.id, jobId));

	return {
		done,
		processedDays,
		totalDays,
		progressPct: Math.round((processedDays / (totalDays || 1)) * 100),
		nextDate: done ? null : afterDate,
		stats: accStats,
		error: null
	};
}

/**
 * Get current progress of a batch job without stepping it.
 */
export async function getBatchJobProgress(jobId: string): Promise<BatchProgress | null> {
	const [job] = await db
		.select()
		.from(backgroundJobs)
		.where(eq(backgroundJobs.id, jobId))
		.limit(1);

	if (!job) return null;

	const result = (job.result ?? {}) as {
		processedDays: number;
		totalDays: number;
		nextDate: string | null;
		stats: Record<string, unknown>;
	};

	const done = job.status === 'completed' || job.status === 'canceled';
	const processedDays = result.processedDays ?? 0;
	const totalDays = result.totalDays ?? 1;

	return {
		done,
		processedDays,
		totalDays,
		progressPct: done ? 100 : Math.round((processedDays / totalDays) * 100),
		nextDate: result.nextDate ?? null,
		stats: result.stats ?? {},
		error: job.error ?? null
	};
}
