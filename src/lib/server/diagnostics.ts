import { and, count, desc, gte, lte } from 'drizzle-orm';
import { db } from '$lib/db';
import { backgroundJobs, cronExecutions } from '$lib/db/schema';
import {
	MAX_ROWS,
	summarizeCronRuns,
	summarizeJobCounts,
	toPublicCronRun,
	type DiagnosticsWindow,
	type PublicCronRun
} from '$lib/domain/diagnostics';

/**
 * Datainnhentingen bak `/api/diagnostikk`. Utvelgelsen bor i domenelaget —
 * her er det bare spørringene.
 *
 * **Spørringene velger kolonner eksplisitt.** Ikke `select()` uten argument:
 * det ville hentet `error` og `resultSummary` inn i prosessen og gjort
 * hvitelistingen i `toPublicCronRun` til eneste skanse. To skanser koster
 * ingenting her, og den ene av dem er synlig i en SQL-logg.
 */
export async function loadCronRuns(window: DiagnosticsWindow): Promise<PublicCronRun[]> {
	const rows = await db
		.select({
			jobPath: cronExecutions.jobPath,
			status: cronExecutions.status,
			durationMs: cronExecutions.durationMs,
			executedAt: cronExecutions.executedAt
		})
		.from(cronExecutions)
		.where(
			and(
				gte(cronExecutions.executedAt, new Date(window.fromMs)),
				lte(cronExecutions.executedAt, new Date(window.toMs))
			)
		)
		.orderBy(desc(cronExecutions.executedAt))
		.limit(MAX_ROWS);

	return rows.map(toPublicCronRun);
}

/** Jobbkøen som tellinger per status — aldri rader. Se domenelaget. */
export async function loadJobCounts() {
	const rows = await db
		.select({ status: backgroundJobs.status, count: count() })
		.from(backgroundJobs)
		.groupBy(backgroundJobs.status);

	return summarizeJobCounts(rows.map((r) => ({ status: r.status, count: Number(r.count) })));
}

export async function loadDiagnostics(window: DiagnosticsWindow) {
	const [runs, jobs] = await Promise.all([loadCronRuns(window), loadJobCounts()]);

	return {
		window: {
			from: new Date(window.fromMs).toISOString(),
			to: new Date(window.toMs).toISOString(),
			minutes: window.minutes,
			clamped: window.clamped
		},
		cron: { ...summarizeCronRuns(runs), runs, truncated: runs.length >= MAX_ROWS },
		jobs
	};
}
