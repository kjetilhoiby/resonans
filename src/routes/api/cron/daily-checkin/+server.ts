import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { NudgeOrchestrationService } from '$lib/server/services/nudge-orchestration-service';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';
import { denyUnauthorizedCron } from '$lib/server/cron-guard';

/**
 * GET /api/cron/daily-checkin
 *
 * Daglige check-ins. Dispatcheren kaller hvert 5. minutt (se /api/cron/jobs for
 * skjema); nudgen selv gater på brukerens klokkeslett innenfor et 5-minutters
 * vindu. Beskyttet av `CRON_SECRET` som de øvrige cron-endepunktene.
 *
 * NB: gatet fram til august 2026 på `env.VERCEL_ENV &&`, som utenfor Vercel er
 * alltid falsk — altså ingen auth. Se cron-auth.ts.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	const denied = denyUnauthorizedCron(request);
	if (denied) return denied;

	const result = await withCronTracking('/api/cron/daily-checkin', async () => {
		const nudgeResult = await NudgeOrchestrationService.runDailyCheckInNudges({
			appUrl: url.origin,
			requireRecentTimeWindow: true,
			windowMinutes: 5
		});

		return {
			...nudgeResult,
			note: 'Kun brukere hvor lokal tid er innenfor siste 5 minutter av dailyCheckIn.time blir sendt i denne kjøringen.'
		};
	});

	return json(result);
};
