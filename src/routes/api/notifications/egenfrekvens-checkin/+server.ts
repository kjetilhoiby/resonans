import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { NudgeOrchestrationService } from '$lib/server/services/nudge-orchestration-service';

/**
 * Trigger egenfrekvens-sjekkin-nudges. Kallbart av Vercel Cron eller in-app scheduler.
 * Default: kjør for alle brukere med time-window-sjekk slik at hver bruker bare nudges
 * innenfor sitt valgte tidspunkt-vindu.
 */
async function run(args: { url: URL; userIdOverride?: string }) {
	const userIdParam = args.url.searchParams.get('userId');
	const requireWindowParam = args.url.searchParams.get('requireWindow');
	const windowMinutesParam = Number(args.url.searchParams.get('windowMinutes'));

	const result = await NudgeOrchestrationService.runEgenfrekvensCheckInNudges({
		appUrl: args.url.origin,
		userId: userIdParam || args.userIdOverride,
		windowMinutes: Number.isFinite(windowMinutesParam) && windowMinutesParam > 0 ? windowMinutesParam : 5,
		requireRecentTimeWindow: requireWindowParam === 'false' ? false : true
	});
	return result;
}

export const POST: RequestHandler = async ({ url }) => {
	try {
		const result = await run({ url });
		return json({ success: true, ...result });
	} catch (error) {
		console.error('Error running egenfrekvens check-in nudges:', error);
		return json(
			{ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};

export const GET: RequestHandler = async ({ url }) => {
	// GET-variant for Vercel Cron som bruker GET som default.
	try {
		const result = await run({ url });
		return json({ success: true, ...result });
	} catch (error) {
		console.error('Error running egenfrekvens check-in nudges:', error);
		return json(
			{ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};
