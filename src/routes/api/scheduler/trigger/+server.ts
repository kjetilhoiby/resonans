import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { NudgeOrchestrationService } from '$lib/server/services/nudge-orchestration-service';
import { denyUnauthorizedCron } from '$lib/server/cron-guard';

/**
 * Manuell trigger for daglig innsjekk. For testing eller manuell utsending.
 *
 * Ruta ligger i `PUBLIC_API_PREFIXES` og hadde fram til august 2026 **ingen**
 * autentisering: hvem som helst kunne sende dagens innsjekk-nudge til alle
 * brukere, så mange ganger de ville. Den bruker nå samme hemmelighet som
 * cron-endepunktene, siden det er samme slags kaller.
 */
export const POST: RequestHandler = async ({ request, url }) => {
	const denied = denyUnauthorizedCron(request);
	if (denied) return denied;

	try {
		const result = await NudgeOrchestrationService.runDailyCheckInNudges({
			appUrl: url.origin,
			requireRecentTimeWindow: false
		});

		return json(result);
	} catch (error) {
		console.error('Manual check-in failed:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
