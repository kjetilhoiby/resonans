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
		return json({ status: result.status, timestamp: result.timestamp });
	} catch {
		return json({ status: 'error', timestamp: new Date().toISOString() }, { status: 500 });
	}
};
