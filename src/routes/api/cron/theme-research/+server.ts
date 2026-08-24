import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';
import { runProactiveThemeResearch } from '$lib/server/services/proactive-research-service';
import { denyUnauthorizedCron } from '$lib/server/cron-guard';

// Daglig: forhåndshent research for kommende reise-temaer (destinasjon + startdato
// i nær framtid, uten lagrede funn fra før). Lagres i Research-seksjonen i Filer.
export const GET: RequestHandler = async ({ request }) => {
	const denied = denyUnauthorizedCron(request);
	if (denied) return denied;

	const result = await withCronTracking('/api/cron/theme-research', async () => {
		return runProactiveThemeResearch();
	});

	return json(result);
};
