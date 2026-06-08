import { db } from '$lib/db';
import { cronExecutions } from '$lib/db/schema';
import { and, lt, sql } from 'drizzle-orm';

export async function withCronTracking<T>(
	jobPath: string,
	fn: () => Promise<T>
): Promise<T> {
	const start = Date.now();
	let status: 'success' | 'partial' | 'error' = 'success';
	let resultSummary: Record<string, unknown> | null = null;
	let error: string | undefined;

	try {
		const result = await fn();
		if (result && typeof result === 'object' && 'error' in (result as Record<string, unknown>)) {
			status = 'partial';
		}
		resultSummary = result && typeof result === 'object' ? result as Record<string, unknown> : null;
		return result;
	} catch (err) {
		status = 'error';
		error = err instanceof Error ? err.message : String(err);
		throw err;
	} finally {
		const durationMs = Date.now() - start;
		try {
			await db.insert(cronExecutions).values({
				jobPath,
				status,
				durationMs,
				resultSummary,
				error
			});
			await pruneOldExecutions();
		} catch (logErr) {
			console.error(`[cron-tracker] Failed to log execution for ${jobPath}:`, logErr);
		}
	}
}

async function pruneOldExecutions() {
	if (Math.random() > 0.05) return;
	const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
	await db.delete(cronExecutions).where(lt(cronExecutions.executedAt, thirtyDaysAgo));
}
