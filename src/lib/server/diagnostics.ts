import { and, count, desc, eq, gte, lte, or } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
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
import { toPublicError, toPublicJob, type PublicJob } from '$lib/domain/diagnostics-jobs';

/**
 * Datainnhentingen bak `/api/diagnostikk`. Utvelgelsen bor i domenelaget —
 * her er det bare spørringene.
 *
 * **Spørringene velger kolonner eksplisitt.** Ikke `select()` uten argument:
 * det ville hentet `error`, `payload` og `resultSummary` inn i prosessen og
 * gjort hvitelistingen i domenelaget til eneste skanse. To skanser koster
 * ingenting her, og den ene av dem er synlig i en SQL-logg.
 */

/**
 * Om redigert feiltekst skal med.
 *
 * AV som standard, og det er en beslutning: redaktøren er en denylist som
 * fanger kjente former (Postgres-constraintverdier, e-poster, sifferrekker),
 * og en denylist lekker — et kontonavn i klartekst har ingen form å kjenne
 * igjen. Fingeravtrykket er alltid med og svarer på «samme feil som sist?»
 * uten å røpe noe. Skru på i Coolify når nytten veier tyngre enn risikoen.
 */
function openErrorsEnabled(): boolean {
	return env.DIAGNOSTICS_OPEN_ERRORS === 'true';
}

const MAX_JOB_ROWS = 100;

export async function loadCronRuns(window: DiagnosticsWindow): Promise<PublicCronRun[]> {
	const rows = await db
		.select({
			jobPath: cronExecutions.jobPath,
			status: cronExecutions.status,
			durationMs: cronExecutions.durationMs,
			executedAt: cronExecutions.executedAt,
			// Hentes BARE for å kunne fingeravtrykke/redigere den. Går aldri rått ut.
			error: cronExecutions.error
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

	const includeText = openErrorsEnabled();
	return rows.map((row) => {
		const pub = toPublicCronRun(row);
		const error = toPublicError(row.error, includeText);
		return error ? { ...pub, error } : pub;
	});
}

/** Tellinger per status — billig, og svarer på «står det noe fast i det hele tatt». */
export async function loadJobCounts() {
	const rows = await db
		.select({ status: backgroundJobs.status, count: count() })
		.from(backgroundJobs)
		.groupBy(backgroundJobs.status);

	return summarizeJobCounts(rows.map((r) => ({ status: r.status, count: Number(r.count) })));
}

/**
 * De jobbene man faktisk vil se: det som kjører nå, og det som har feilet.
 *
 * Ikke hele tabellen — 18 000 rader, og 16 757 av dem er fullførte som ingen
 * skal lete i. `running` svarer på «hva står fast», `failed`/`retry` på «hva
 * gikk galt». Fullførte hentes ikke.
 */
export async function loadActiveJobs(now = new Date()): Promise<PublicJob[]> {
	const rows = await db
		.select({
			type: backgroundJobs.type,
			status: backgroundJobs.status,
			attempts: backgroundJobs.attempts,
			maxAttempts: backgroundJobs.maxAttempts,
			runAt: backgroundJobs.runAt,
			startedAt: backgroundJobs.startedAt,
			lockedAt: backgroundJobs.lockedAt,
			lockedBy: backgroundJobs.lockedBy,
			createdAt: backgroundJobs.createdAt,
			error: backgroundJobs.error
		})
		.from(backgroundJobs)
		.where(
			or(
				eq(backgroundJobs.status, 'running'),
				eq(backgroundJobs.status, 'failed'),
				eq(backgroundJobs.status, 'retry'),
				eq(backgroundJobs.status, 'queued')
			)
		)
		.orderBy(desc(backgroundJobs.runAt))
		.limit(MAX_JOB_ROWS);

	const includeText = openErrorsEnabled();
	return rows.map((row) => {
		const pub = toPublicJob(row, now);
		const error = toPublicError(row.error, includeText);
		return error ? { ...pub, error } : pub;
	});
}

export async function loadDiagnostics(window: DiagnosticsWindow, now = new Date()) {
	const [runs, counts, active] = await Promise.all([
		loadCronRuns(window),
		loadJobCounts(),
		loadActiveJobs(now)
	]);

	return {
		window: {
			from: new Date(window.fromMs).toISOString(),
			to: new Date(window.toMs).toISOString(),
			minutes: window.minutes,
			clamped: window.clamped
		},
		cron: { ...summarizeCronRuns(runs), runs, truncated: runs.length >= MAX_ROWS },
		jobs: {
			...counts,
			active,
			stuck: active.filter((j) => j.stuck).length,
			truncated: active.length >= MAX_JOB_ROWS
		},
		// Sier om feiltekst er med, så et tomt `error.redacted` ikke leses som
		// «ingen feilmelding finnes».
		errorTextEnabled: openErrorsEnabled()
	};
}
