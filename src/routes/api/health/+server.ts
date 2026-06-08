import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { runHealthCheck } from '$lib/server/services/monitoring-service';

export const GET: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('authorization');
	const isAuthed = env.CRON_SECRET && authHeader === `Bearer ${env.CRON_SECRET}`;

	if (isAuthed) {
		const result = await runHealthCheck();
		return json(result);
	}

	try {
		const result = await runHealthCheck();
		return json({ status: result.status, timestamp: result.timestamp });
	} catch {
		return json({ status: 'error', timestamp: new Date().toISOString() }, { status: 500 });
	}
};
