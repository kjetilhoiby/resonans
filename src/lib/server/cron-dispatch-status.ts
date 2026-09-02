import { env } from '$env/dynamic/private';
import { db, rowsOf } from '$lib/db';
import { cronDispatchClaims, cronExecutions } from '$lib/db/schema';
import { desc, gte, sql } from 'drizzle-orm';
import { LEADER_LOCK_NAME, cronDispatcherLocalState } from '$lib/server/cron-dispatcher';
import {
	describeDispatchStatus,
	summarizeClaimants,
	type ClaimantCounts,
	type DispatchVerdict
} from '$lib/domain/cron-dispatch-verdict';

/**
 * Status for cron-dispatcheren, lest fra basen — for /settings/jobs.
 *
 * `lockHeld` spør pg_locks om NOEN sesjon holder lederlåsen, fordi
 * web-forespørselen kan treffe standby-instansen under en rullende
 * oppdatering: den lokale tilstanden sier da «ikke leder» mens klokka går
 * helt fint i nabocontaineren.
 */
export type CronDispatchStatus = {
	enabled: boolean;
	local: { running: boolean; leader: boolean };
	lockHeld: boolean;
	counts: ClaimantCounts;
	verdict: DispatchVerdict;
	recentClaims: Array<{
		jobPath: string;
		slotAt: Date;
		claimedBy: string | null;
		claimedAt: Date;
	}>;
	recentExecutions: Array<{
		jobPath: string;
		status: string;
		durationMs: number | null;
		executedAt: Date;
	}>;
};

export async function loadCronDispatchStatus(): Promise<CronDispatchStatus> {
	const dayAgo = new Date(Date.now() - 24 * 3600_000);

	const [lockRows, claimantRows, recentClaims, recentExecutions] = await Promise.all([
		// Advisory-låsens bigint-nøkkel splittes av Postgres i classid (høye 32
		// bit) og objid (lave 32) — samme uttrykk som pg_try_advisory_lock bruker,
		// så spørringen finner nøyaktig vår lås uansett fortegn på hashtext.
		db.execute(sql`
			select count(*)::int as held
			from pg_locks
			where locktype = 'advisory' and granted
				and classid::bigint = ((hashtext(${LEADER_LOCK_NAME})::bigint >> 32) & 4294967295)
				and objid::bigint = (hashtext(${LEADER_LOCK_NAME})::bigint & 4294967295)
		`),
		db
			.select({
				claimedBy: cronDispatchClaims.claimedBy,
				count: sql<number>`count(*)::int`
			})
			.from(cronDispatchClaims)
			.where(gte(cronDispatchClaims.claimedAt, dayAgo))
			.groupBy(cronDispatchClaims.claimedBy),
		db
			.select({
				jobPath: cronDispatchClaims.jobPath,
				slotAt: cronDispatchClaims.slotAt,
				claimedBy: cronDispatchClaims.claimedBy,
				claimedAt: cronDispatchClaims.claimedAt
			})
			.from(cronDispatchClaims)
			.orderBy(desc(cronDispatchClaims.slotAt))
			.limit(8),
		db
			.select({
				jobPath: cronExecutions.jobPath,
				status: cronExecutions.status,
				durationMs: cronExecutions.durationMs,
				executedAt: cronExecutions.executedAt
			})
			.from(cronExecutions)
			.orderBy(desc(cronExecutions.executedAt))
			.limit(8)
	]);

	const lockHeld = Number(rowsOf(lockRows)[0]?.held ?? 0) > 0;
	const enabled = env.ENABLE_CRON_DISPATCHER === 'true';
	const counts = summarizeClaimants(claimantRows);

	return {
		enabled,
		local: cronDispatcherLocalState(),
		lockHeld,
		counts,
		verdict: describeDispatchStatus({ enabled, lockHeld, counts }),
		recentClaims,
		recentExecutions
	};
}
