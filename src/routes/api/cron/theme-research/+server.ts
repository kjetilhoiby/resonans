import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { withCronTracking } from '$lib/server/monitoring/cron-wrapper';
import { runProactiveThemeResearch } from '$lib/server/services/proactive-research-service';

// Daglig: forhåndshent research for kommende reise-temaer (destinasjon + startdato
// i nær framtid, uten lagrede funn fra før). Lagres i Research-seksjonen i Filer.
export const GET: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('authorization');
	if (env.VERCEL_ENV && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const result = await withCronTracking('/api/cron/theme-research', async () => {
		return runProactiveThemeResearch();
	});

	return json(result);
};
