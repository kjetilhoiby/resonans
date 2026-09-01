import { db } from '$lib/db';
import { cronDispatchClaims, cronExecutions } from '$lib/db/schema';
import { and, eq, lt, sql } from 'drizzle-orm';
import { CRON_JOBS, type CronJob } from '$lib/server/cron-jobs';
import { dueSlot } from '$lib/server/cron-schedule';

/**
 * Due-beregning med kravtaking — den ENE veien til «hvilke jobber skal kjøre nå».
 *
 * Både `/api/cron/jobs?due=1` (GitHub Actions) og in-app-dispatcheren går
 * gjennom denne. To trinn:
 *
 * 1. Due mot `cron_executions` (siste FERDIGE kjøring) — dekker historikken
 *    fra før kravtabellen fantes, og holder lookback-vinduet ærlig.
 * 2. Krav mot `cron_dispatch_claims` med INSERT … ON CONFLICT DO NOTHING —
 *    bare jobbene hvis (path, slot)-insert vant returneres. Det er dette som
 *    gjør to samtidige klokker trygge: `cron_executions` skrives først når
 *    jobben er ferdig, så uten kravet ser en jobb som fortsatt kjører ut som
 *    due for den andre klokka.
 *
 * Konsekvens å kjenne til: et krav som er tatt, men der selve dispatchen
 * aldri nådde serveren, blokkerer slotet til noen slipper det
 * (`releaseCronDispatchClaim`) eller neste slot kommer. Dispatcheren slipper
 * kravet ved nettverksfeil; GitHub Actions kan ikke, men feiler da høyt i
 * workflow-loggen.
 */
export type DueCronJob = { job: CronJob; slot: Date };

export async function claimDueCronJobs(opts: {
	claimedBy: string;
	now?: Date;
	jobs?: CronJob[];
}): Promise<DueCronJob[]> {
	const now = opts.now ?? new Date();
	const jobs = opts.jobs ?? CRON_JOBS;

	// Siste faktiske kjøring per jobb (uavhengig av status) for dedup.
	const lastRunRows = await db
		.select({
			jobPath: cronExecutions.jobPath,
			lastRunAt: sql<string>`max(${cronExecutions.executedAt})`
		})
		.from(cronExecutions)
		.groupBy(cronExecutions.jobPath);

	const lastRunByPath = new Map<string, Date>();
	for (const row of lastRunRows) {
		if (row.lastRunAt) lastRunByPath.set(row.jobPath, new Date(row.lastRunAt));
	}

	const candidates: DueCronJob[] = [];
	for (const job of jobs) {
		const slot = dueSlot(job.schedule, now, lastRunByPath.get(job.path) ?? null);
		if (slot) candidates.push({ job, slot });
	}
	if (candidates.length === 0) return [];

	const won = await db
		.insert(cronDispatchClaims)
		.values(
			candidates.map((c) => ({
				jobPath: c.job.path,
				slotAt: c.slot,
				claimedBy: opts.claimedBy
			}))
		)
		.onConflictDoNothing({ target: [cronDispatchClaims.jobPath, cronDispatchClaims.slotAt] })
		.returning({ jobPath: cronDispatchClaims.jobPath });

	const wonPaths = new Set(won.map((r) => r.jobPath));
	await pruneOldClaims();
	return candidates.filter((c) => wonPaths.has(c.job.path));
}

/**
 * Slipp et krav — brukes når dispatchen aldri nådde serveren (nettverksfeil),
 * slik at et senere tick innenfor lookback-vinduet kan prøve slotet på nytt.
 * Skal IKKE kalles ved timeout eller feilstatus: da kjører (eller kjørte)
 * jobben på serveren, og et sluppet krav ville dispatchet den én gang til.
 */
export async function releaseCronDispatchClaim(jobPath: string, slotAt: Date): Promise<void> {
	await db
		.delete(cronDispatchClaims)
		.where(and(eq(cronDispatchClaims.jobPath, jobPath), eq(cronDispatchClaims.slotAt, slotAt)));
}

/** Samme sannsynlighetsbaserte prune som cron_executions, men 7 dager — kravene har ingen auditverdi. */
async function pruneOldClaims() {
	if (Math.random() > 0.02) return;
	const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
	try {
		await db.delete(cronDispatchClaims).where(lt(cronDispatchClaims.claimedAt, sevenDaysAgo));
	} catch (err) {
		console.error('[cron-due] prune av gamle dispatch-krav feilet:', err);
	}
}
