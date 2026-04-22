import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { NudgeOrchestrationService } from '$lib/server/services/nudge-orchestration-service';

/**
 * Manual trigger for daily check-in
 * Kan brukes for testing eller manuell sending
 */
export const POST: RequestHandler = async ({ url }) => {
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
