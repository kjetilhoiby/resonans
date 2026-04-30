import { db } from '$lib/db';
import { backgroundJobs } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export interface BatchHandler<TStats extends Record<string, unknown> = Record<string, unknown>> {
	/**
	 * Optional: fetch all external data for the full date range upfront.
	 * If defined, called once during startBatchJob and the result is stored in the job payload.
	 * processDay/processStep then receives the full prefetched blob so it can do pure DB writes.
	 */
	prefetch?(userId: string, fromDate: string, toDate: string): Promise<Record<string, unknown>>;

	/**
	 * Number of days to advance per step. Default: 1.
	 * Set to e.g. 31 for monthly steps to reduce external API call frequency.
	 */
	stepSizeDays?: number;

	/**
	 * Process a date range in one step. If defined, used instead of processDay.
	 * Return waitMs > 0 to signal the UI to pause before the next step (rate limiting).
	 */
	processStep?(userId: string, fromDate: string, toDate: string, prefetchedData?: Record<string, unknown>): Promise<{ stats: TStats; waitMs?: number }>;

	/** Process one calendar day. Used when processStep is not defined. */
	processDay(userId: string, date: string, prefetchedData?: Record<string, unknown>): Promise<TStats>;

	mergeStats(accumulated: TStats, step: TStats): TStats;
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

function addDays(date: string, days: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().split('T')[0];
}

function minDate(a: string, b: string): string {
	return a <= b ? a : b;
}

export type BatchProgress = {
	done: boolean;
	processedDays: number;
	totalDays: number;
	progressPct: number;
	nextDate: string | null;
	stats: Record<string, unknown>;
	error: string | null;
	waitMs?: number;
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

	let prefetchedData: Record<string, unknown> | undefined;
	if (handler.prefetch) {
		prefetchedData = await handler.prefetch(opts.userId, opts.fromDate, opts.toDate);
	}

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
				...(opts.extraPayload ?? {}),
				...(prefetchedData !== undefined ? { prefetchedData } : {})
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
 * Process one step of an existing batch job. Call repeatedly from the UI until done === true.
 * If waitMs > 0 in the response, wait that many ms before calling again (rate limit backoff).
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

	if (job.status === 'completed' || job.status === 'canceled') {
		return { done: true, processedDays: result.processedDays ?? 0, totalDays: result.totalDays ?? 0, progressPct: 100, nextDate: null, stats: result.stats ?? {}, error: null };
	}
	if (job.status === 'failed') {
		return { done: true, processedDays: result.processedDays ?? 0, totalDays: result.totalDays ?? 0, progressPct: Math.round(((result.processedDays ?? 0) / (result.totalDays || 1)) * 100), nextDate: result.nextDate ?? null, stats: result.stats ?? {}, error: job.error ?? 'Unknown error' };
	}

	const payload = job.payload as {
		batchType: string;
		fromDate: string;
		toDate: string;
		prefetchedData?: Record<string, unknown>;
	};

	const handler = registry.get(payload.batchType);
	if (!handler) throw new Error(`No batch handler registered for type: ${payload.batchType}`);

	const stepSize = Math.max(1, handler.stepSizeDays ?? 1);
	const nextDate = result.nextDate ?? payload.fromDate;
	const stepToDate = minDate(addDays(nextDate, stepSize - 1), payload.toDate);
	const totalDays = result.totalDays ?? 0;
	let processedDays = result.processedDays ?? 0;
	let accStats = result.stats ?? {};
	let waitMs: number | undefined;

	try {
		let stepStats: Record<string, unknown>;

		if (handler.processStep) {
			const stepResult = await handler.processStep(job.userId!, nextDate, stepToDate, payload.prefetchedData);
			stepStats = stepResult.stats;
			waitMs = stepResult.waitMs;
		} else {
			stepStats = await handler.processDay(job.userId!, nextDate, payload.prefetchedData);
		}

		accStats = handler.mergeStats(accStats as any, stepStats as any);
		processedDays += stepSize;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await db
			.update(backgroundJobs)
			.set({ status: 'failed', error: message, finishedAt: new Date(), updatedAt: new Date(), result: { ...result, processedDays, nextDate, stats: accStats } })
			.where(eq(backgroundJobs.id, jobId));
		return { done: true, processedDays, totalDays, progressPct: Math.round((processedDays / (totalDays || 1)) * 100), nextDate, stats: accStats, error: message };
	}

	const afterDate = addDays(nextDate, stepSize);
	const done = nextDate >= payload.toDate;

	await db
		.update(backgroundJobs)
		.set({
			status: done ? 'completed' : 'running',
			result: { processedDays, totalDays, nextDate: done ? null : afterDate, stats: accStats },
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
		error: null,
		...(waitMs ? { waitMs } : {})
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
