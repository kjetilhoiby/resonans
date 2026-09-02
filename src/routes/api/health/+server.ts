import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { runHealthCheck } from '$lib/server/services/monitoring-service';

export const GET: RequestHandler = async ({ request, url }) => {
	const authHeader = request.headers.get('authorization');
	const isAuthed = env.CRON_SECRET && authHeader === `Bearer ${env.CRON_SECRET}`;
	const debug = url.searchParams.has('debug');

	try {
		const result = await runHealthCheck();
		if (isAuthed || debug) return json(result);
		// `clock` er med i det uautentiserte svaret MED VILJE: vakthunden
		// (.github/workflows/watchdog.yml) har ingen hemmelighet, og pulsen
		// («en cron-kjøring skjedde nylig») lekker ingenting. Monitoreringen
		// selv dispatches av klokka den overvåker, så dette er det ene signalet
		// som må kunne leses utenfra.
		return json({ status: result.status, clock: result.clock, timestamp: result.timestamp });
	} catch {
		return json({ status: 'error', timestamp: new Date().toISOString() }, { status: 500 });
	}
};
