import { db } from '$lib/db';
import { cronExecutions } from '$lib/db/schema';
import { and, lt, sql } from 'drizzle-orm';
import { classifyCronResult } from './cron-result';
import { describeErrorForStorage } from '$lib/domain/error-text';

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
		status = classifyCronResult(result);
		resultSummary = result && typeof result === 'object' ? result as Record<string, unknown> : null;
		return result;
	} catch (err) {
		status = 'error';
		// Kappes ved SKRIVING, av samme grunn som i background-jobs: kolonnen er
		// `text` uten grense, og en drizzle-feil bærer hele SQL-en og hver
		// parameter. `cron_executions` er ikke målt like ille som jobbtabellen,
		// men den har ingen grense den heller — og et cron-endepunkt som lar et
		// bulk-insert kaste, skriver nøyaktig samme dump.
		error = describeErrorForStorage(err);
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
