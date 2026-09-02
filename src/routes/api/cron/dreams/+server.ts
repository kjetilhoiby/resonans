import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { DreamService } from '$lib/server/services/dream-service';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';
import { denyUnauthorizedCron } from '$lib/server/cron-guard';

const LEVELS = ['daily', 'weekly', 'monthly', 'yearly'] as const;
type Level = (typeof LEVELS)[number];

/**
 * GET /api/cron/dreams?level=daily|weekly|monthly|yearly
 *
 * Kjører ett nivå av drøm-pyramiden for alle brukere. Hvert nivå leser
 * sammendraget under seg, så registeret i /api/cron/jobs planlegger nivåene
 * på adskilte (og ulike) tidspunkter slik at rekkefølgen holdes (dag → uke →
 * måned → år). Tidsstyringen lå tidligere i den in-app node-cron-scheduleren
 * (scheduler.ts), som ikke overlevde en serverless-kjøring — derfor flyttet hit.
 * Registeret er nå eneste sted en jobb planlegges.
 */
export const GET: RequestHandler = async ({ request }) => {
	const denied = denyUnauthorizedCron(request);
	if (denied) return denied;

	const levelRaw = new URL(request.url).searchParams.get('level') ?? 'daily';
	if (!LEVELS.includes(levelRaw as Level)) {
		return json({ error: `Ukjent level: ${levelRaw}` }, { status: 400 });
	}
	const level = levelRaw as Level;

	const result = await withCronTracking(`/api/cron/dreams:${level}`, async () => {
		switch (level) {
			case 'daily':
				await DreamService.runDailyForAllUsers();
				break;
			case 'weekly':
				await DreamService.runWeeklyForAllUsers();
				break;
			case 'monthly':
				await DreamService.runMonthlyForAllUsers();
				break;
			case 'yearly':
				await DreamService.runYearlyForAllUsers();
				break;
		}
		return { success: true, level };
	});

	return json(result);
};
