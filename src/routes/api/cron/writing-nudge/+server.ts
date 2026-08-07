import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { sendWritingNudgesForAllUsers } from '$lib/server/writing-nudge';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';

export const config = { maxDuration: 120 };

/**
 * GET /api/cron/writing-nudge
 *
 * Kveldens skriveøvelse. Kjøres hver time; nudgen selv gater på klokkeslett
 * (19–22 Oslo), på at det ikke alt er skrevet i dag, og på at den ikke alt er
 * sendt i dag.
 *
 * `?force=1` hopper over dedup, til manuell verifisering. Øvelsen er
 * deterministisk per dag, så en force-kjøring gir samme øvelse som den ekte.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	const authHeader = request.headers.get('authorization');
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const force = url.searchParams.get('force') === '1';

	const result = await withCronTracking('/api/cron/writing-nudge', async () => {
		const nudgeResult = await sendWritingNudgesForAllUsers(env.ORIGIN ?? url.origin, new Date(), {
			force
		});
		return { success: true, ...nudgeResult };
	});

	return json(result);
};
