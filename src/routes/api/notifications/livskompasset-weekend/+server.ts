import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { NudgeOrchestrationService } from '$lib/server/services/nudge-orchestration-service';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';

/**
 * Trigger ukentlig Livskompasset-helge-nudge. Kallbart av cron-dispatcheren.
 * Default: kjør for alle brukere med lørdag- + tidsvindu-sjekk per bruker.
 */
async function run(args: { url: URL; userIdOverride?: string }) {
	const userIdParam = args.url.searchParams.get('userId');
	const requireWindowParam = args.url.searchParams.get('requireWindow');
	const windowMinutesParam = Number(args.url.searchParams.get('windowMinutes'));

	return NudgeOrchestrationService.runLivskompassWeekendNudges({
		appUrl: args.url.origin,
		userId: userIdParam || args.userIdOverride,
		windowMinutes: Number.isFinite(windowMinutesParam) && windowMinutesParam > 0 ? windowMinutesParam : 15,
		requireRecentTimeWindow: requireWindowParam === 'false' ? false : true
	});
}

async function handle(url: URL, request: Request) {
	const authHeader = request.headers.get('authorization');
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	try {
		const result = await withCronTracking('/api/notifications/livskompasset-weekend', () => run({ url }));
		return json({ success: true, ...result });
	} catch (error) {
		console.error('Error running livskompasset weekend nudges:', error);
		return json(
			{ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
}

export const GET: RequestHandler = async ({ url, request }) => handle(url, request);
export const POST: RequestHandler = async ({ url, request }) => handle(url, request);
