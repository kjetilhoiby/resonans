import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { syncDropboxWorkoutsForAllUsers } from '$lib/server/integrations/dropbox-sync';

export const config = { maxDuration: 120 };

export const GET: RequestHandler = async ({ request, url }) => {
	const authHeader = request.headers.get('authorization');
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const result = await syncDropboxWorkoutsForAllUsers({ appUrl: url.origin });
	const failed = result.results.filter((r) => r.success === false).length;
	return json({
		success: true,
		users: result.users,
		failed,
		results: result.results
	});
};
