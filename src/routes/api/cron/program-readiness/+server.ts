import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { NudgeOrchestrationService } from '$lib/server/services/nudge-orchestration-service';

/**
 * Vercel Cron-endepunkt for program-tilstand-pushen.
 * Kalles hvert 5. minutt — kun brukere innenfor sitt programReadiness.time-vindu
 * (default 06:30 lokal tid) får push.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	const authHeader = request.headers.get('authorization');
	if (env.VERCEL_ENV && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const result = await NudgeOrchestrationService.runProgramReadinessNudges({
			appUrl: url.origin,
			requireRecentTimeWindow: true,
			windowMinutes: 5
		});
		return json(result);
	} catch (error) {
		console.error('[cron/program-readiness] failed:', error);
		return json(
			{ success: false, error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};
