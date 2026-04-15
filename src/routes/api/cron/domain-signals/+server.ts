import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { runDomainSignalProducers } from '$lib/server/domain-signals';

export const config = { maxDuration: 120 };

// Daily/periodic cron endpoint for refreshing cross-domain derived signals.
export const GET: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('authorization');
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const result = await runDomainSignalProducers();
		return json({ success: true, ...result });
	} catch (error) {
		console.error('Domain signal cron failed:', error);
		return json(
			{ success: false, error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};
