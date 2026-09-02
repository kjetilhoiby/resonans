import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { sendSickCheckinsForAllUsers } from '$lib/server/sick-checkin';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';
import { denyUnauthorizedCron } from '$lib/server/cron-guard';


/**
 * GET /api/cron/sick-checkin
 *
 * «Hvordan går det?» mens en sykeperiode står. Kjøres hver time; nudgen selv
 * gater på klokkeslett (11–21 Oslo), på at en periode med kjent startdag er
 * aktiv, på at det ikke er dag 1, og på en kadens som faller av med varigheten
 * (daglig → hver 2. → hver 4. → ukentlig).
 *
 * `?force=1` hopper over kadens og tidsvindu, til manuell verifisering.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	const denied = denyUnauthorizedCron(request);
	if (denied) return denied;

	const force = url.searchParams.get('force') === '1';

	const result = await withCronTracking('/api/cron/sick-checkin', async () => {
		const nudgeResult = await sendSickCheckinsForAllUsers(env.ORIGIN ?? url.origin, new Date(), {
			force
		});
		return { success: true, ...nudgeResult };
	});

	return json(result);
};
