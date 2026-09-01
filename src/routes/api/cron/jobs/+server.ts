import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { denyUnauthorizedCron } from '$lib/server/cron-guard';
import { CRON_JOBS } from '$lib/server/cron-jobs';
import { claimDueCronJobs } from '$lib/server/cron-due';

/**
 * GET /api/cron/jobs
 * Returnerer alle registrerte cron-jobber med path og schedule.
 *
 * GET /api/cron/jobs?due=1
 * Returnerer kun jobbene som skal kjøre nå, og TAR samtidig dispatch-kravet
 * for slotene (se cron-due.ts) — så GitHub Actions og in-app-dispatcheren kan
 * gå som to samtidige klokker uten å dobbeltkjøre. Wire-formatet er uendret:
 * en liste av jobber, som workflowen fetcher én etter én.
 *
 * Registeret bor i `$lib/server/cron-jobs.ts` — legg nye jobber der.
 */

export type { CronJob } from '$lib/server/cron-jobs';

export const GET: RequestHandler = async ({ request, url }) => {
	const denied = denyUnauthorizedCron(request);
	if (denied) return denied;

	if (url.searchParams.get('due') !== '1') {
		return json(CRON_JOBS);
	}

	const due = await claimDueCronJobs({ claimedBy: 'github-actions' });
	return json(due.map((d) => d.job));
};
