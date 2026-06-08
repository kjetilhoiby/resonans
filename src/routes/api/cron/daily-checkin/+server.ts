import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { NudgeOrchestrationService } from '$lib/server/services/nudge-orchestration-service';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';

/**
 * Vercel Cron endpoint for daglige check-ins
 * Kjøres automatisk hver dag kl. 09:00 (UTC - juster etter tidssone)
 * 
 * VIKTIG: Denne endepunktet er beskyttet av Vercel Cron secret
 */
export const GET: RequestHandler = async ({ request, url }) => {
	// Verify that this is a legitimate Vercel Cron request
	const authHeader = request.headers.get('authorization');
	if (env.VERCEL_ENV && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

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
